import { fromApiToken } from "@distilled.cloud/cloudflare/Credentials";
import type { CloudflareOpContext } from "@distilled.cloud/cloudflare/dns";
import * as DNS from "@distilled.cloud/cloudflare/dns";
import type { Database, DatabaseExecutor } from "@repo/persistence/db/effect";
import { DB } from "@repo/persistence/db/effect";
import {
  type DnsRecordPurpose,
  type DnsRecordType,
  type EmailDnsRecord,
  type EmailDnsRecordRole,
  type EmailDnsRecordStatus,
  emailDnsRecord,
} from "@repo/persistence/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Data, DateTime, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";

export interface ManagedDnsRecord {
  readonly name: string;
  readonly priority?: number;
  readonly purpose: DnsRecordPurpose;
  readonly recordType: DnsRecordType;
  readonly role: EmailDnsRecordRole;
  readonly status?: EmailDnsRecordStatus;
  readonly value: string;
}

export interface ManagedDnsRecordSet {
  /** Zone used for Cloudflare upserts; omit for DB-only (customer-published). */
  readonly cloudflareZoneId?: string;
  readonly customDomainId?: string;
  readonly owner: string;
  readonly records: readonly ManagedDnsRecord[];
  readonly sandboxDomainId?: string;
}

export type ManagedDnsOperation =
  | "delete_cloudflare"
  | "persist"
  | "reconcile"
  | "remove"
  | "upsert_cloudflare";

export class ManagedDnsError extends Data.TaggedError("ManagedDnsError")<{
  readonly cause?: unknown;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: ManagedDnsOperation;
  readonly owner?: string;
  readonly recordName?: string;
  readonly zoneId?: string;
}> {}

export interface EmailManagedDnsConfig {
  readonly apiToken: string;
  readonly rootDomain: string;
  readonly zoneId: string;
}

export interface EmailManagedDnsService {
  /** True when Cloudflare credentials are wired (live layer, not noop). */
  readonly cloudflareEnabled: boolean;
  readonly reconcile: (
    recordSet: ManagedDnsRecordSet
  ) => Effect.Effect<void, ManagedDnsError>;
  readonly remove: (owner: string) => Effect.Effect<void, ManagedDnsError>;
}

/** Cloudflare requires TXT record content to be wrapped in quotation marks. */
export const formatTxtRecordContent = (content: string): string => {
  const trimmed = content.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }

  return `"${trimmed}"`;
};

const TRAILING_DOT_REGEX = /\.$/;
const CF_RECORD_DOES_NOT_EXIST_ERROR_CODE = 81_044;

const recordKey = (record: {
  readonly purpose: DnsRecordPurpose;
  readonly role: EmailDnsRecordRole;
}) => `${record.role}:${record.purpose}`;

type ProvideCloudflare = <A, E>(
  effect: Effect.Effect<A, E, CloudflareOpContext | HttpClient.HttpClient>
) => Effect.Effect<A, E>;

const isMissingDnsRecord = (error: unknown): boolean => {
  const tagged = error as {
    readonly _tag?: string;
    readonly errors?: readonly { readonly code?: number }[];
  };
  switch (tagged._tag) {
    case "NotFound":
      return true;
    case "CloudflareError":
      return (
        tagged.errors?.some(
          (entry) => entry.code === CF_RECORD_DOES_NOT_EXIST_ERROR_CODE
        ) ?? false
      );
    default:
      return false;
  }
};

const dnsContent = (recordType: DnsRecordType, value: string) =>
  recordType === "TXT" ? formatTxtRecordContent(value) : value;

const upsertCloudflareDnsRecord = ({
  owner,
  provide,
  zoneId,
  rootDomain,
  record,
}: {
  owner?: string;
  provide: ProvideCloudflare;
  record: {
    content: string;
    name: string;
    priority?: number;
    type: DnsRecordType;
  };
  rootDomain: string;
  zoneId: string;
}) =>
  Effect.gen(function* () {
    const content = dnsContent(record.type, record.content);
    const payload = {
      content,
      name: record.name,
      proxied: false,
      ttl: 1,
      type: record.type,
      zoneId,
      ...(record.type === "MX" && record.priority !== undefined
        ? { priority: record.priority }
        : {}),
    };

    const createdId = yield* provide(DNS.createRecord(payload)).pipe(
      Effect.map((created) => created.id as string | undefined),
      Effect.catchTag("DnsRecordAlreadyExists", () =>
        Effect.succeed(undefined as string | undefined)
      )
    );

    if (createdId) {
      return createdId;
    }

    const fqdn = record.name.endsWith(rootDomain)
      ? record.name
      : `${record.name}.${rootDomain}`;
    const exactName = fqdn.replace(TRAILING_DOT_REGEX, "");

    const existing = yield* provide(
      DNS.listRecords({
        name: { exact: exactName },
        perPage: 5,
        type: record.type,
        zoneId,
      })
    ).pipe(Effect.map((page) => page.result[0]));

    if (!existing?.id) {
      return yield* new ManagedDnsError({
        message:
          "Cloudflare reported a duplicate DNS record but none could be found to overwrite.",
        operation: "upsert_cloudflare",
        owner,
        recordName: record.name,
        zoneId,
      });
    }

    yield* provide(
      DNS.updateRecord({
        ...payload,
        dnsRecordId: existing.id,
        zoneId,
      })
    );

    return existing.id;
  }).pipe(
    Effect.mapError((cause) => {
      switch (cause._tag) {
        case "ManagedDnsError":
          return cause;
        default:
          return new ManagedDnsError({
            cause,
            message: "Failed to upsert Cloudflare DNS record.",
            operation: "upsert_cloudflare",
            owner,
            recordName: record.name,
            zoneId,
          });
      }
    })
  );

const deleteCloudflareRecords = (
  provide: ProvideCloudflare,
  records: readonly Pick<
    EmailDnsRecord,
    "cloudflareRecordId" | "cloudflareZoneId"
  >[],
  owner?: string
) =>
  Effect.gen(function* () {
    const byZone = new Map<string, string[]>();
    for (const record of records) {
      if (!(record.cloudflareZoneId && record.cloudflareRecordId)) {
        continue;
      }
      const ids = byZone.get(record.cloudflareZoneId) ?? [];
      ids.push(record.cloudflareRecordId);
      byZone.set(record.cloudflareZoneId, ids);
    }

    for (const [zoneId, ids] of byZone) {
      yield* provide(
        DNS.batchRecord({
          deletes: ids.map((id) => ({ id })),
          zoneId,
        })
      ).pipe(
        Effect.catchIf(isMissingDnsRecord, () => Effect.void),
        Effect.mapError(
          (cause) =>
            new ManagedDnsError({
              cause,
              message: "Failed to delete Cloudflare DNS records.",
              operation: "delete_cloudflare",
              owner,
              zoneId,
            })
        )
      );
    }
  });

const findExistingForRecord = (
  db: DatabaseExecutor,
  recordSet: ManagedDnsRecordSet,
  record: ManagedDnsRecord
) =>
  Effect.gen(function* () {
    if (record.role === "shared") {
      const [row] = yield* db
        .select()
        .from(emailDnsRecord)
        .where(
          and(
            eq(emailDnsRecord.role, "shared"),
            eq(emailDnsRecord.purpose, record.purpose)
          )
        )
        .limit(1);
      return row;
    }

    if (recordSet.sandboxDomainId) {
      const [row] = yield* db
        .select()
        .from(emailDnsRecord)
        .where(
          and(
            eq(emailDnsRecord.sandboxDomainId, recordSet.sandboxDomainId),
            eq(emailDnsRecord.role, record.role),
            eq(emailDnsRecord.purpose, record.purpose)
          )
        )
        .limit(1);
      return row;
    }

    if (recordSet.customDomainId) {
      const [row] = yield* db
        .select()
        .from(emailDnsRecord)
        .where(
          and(
            eq(emailDnsRecord.customDomainId, recordSet.customDomainId),
            eq(emailDnsRecord.role, record.role),
            eq(emailDnsRecord.purpose, record.purpose)
          )
        )
        .limit(1);
      return row;
    }

    const [row] = yield* db
      .select()
      .from(emailDnsRecord)
      .where(
        and(
          eq(emailDnsRecord.owner, recordSet.owner),
          eq(emailDnsRecord.role, record.role),
          eq(emailDnsRecord.purpose, record.purpose)
        )
      )
      .limit(1);
    return row;
  });

const upsertManagedRecord = ({
  config,
  db,
  provide,
  record,
  recordSet,
  zoneId,
}: {
  config: EmailManagedDnsConfig | null;
  db: Database;
  provide: ProvideCloudflare | null;
  record: ManagedDnsRecord;
  recordSet: ManagedDnsRecordSet;
  zoneId: string | undefined;
}) =>
  Effect.gen(function* () {
    const existing = yield* findExistingForRecord(db, recordSet, record).pipe(
      Effect.mapError(
        (cause) =>
          new ManagedDnsError({
            cause,
            message: "Failed to look up managed DNS record.",
            operation: "persist",
            owner: recordSet.owner,
            recordName: record.name,
          })
      )
    );
    const status = record.status ?? "pending";
    const now = DateTime.toDate(DateTime.nowUnsafe());
    let cloudflareRecordId = existing?.cloudflareRecordId ?? null;
    let cloudflareZoneId = existing?.cloudflareZoneId ?? null;

    if (zoneId && provide && config) {
      const existingZoneId = existing?.cloudflareZoneId;
      const existingRecordId = existing?.cloudflareRecordId;

      if (existingZoneId && existingRecordId) {
        const content = dnsContent(record.recordType, record.value);
        const updated = yield* provide(
          DNS.updateRecord({
            content,
            dnsRecordId: existingRecordId,
            name: record.name,
            proxied: false,
            ttl: 1,
            type: record.recordType,
            zoneId: existingZoneId,
            ...(record.recordType === "MX" && record.priority !== undefined
              ? { priority: record.priority }
              : {}),
          })
        ).pipe(
          Effect.as(true),
          Effect.catchIf(isMissingDnsRecord, () => Effect.succeed(false)),
          Effect.mapError(
            (cause) =>
              new ManagedDnsError({
                cause,
                message: "Failed to update Cloudflare DNS record.",
                operation: "upsert_cloudflare",
                owner: recordSet.owner,
                recordName: record.name,
                zoneId: existingZoneId,
              })
          )
        );

        if (updated) {
          cloudflareRecordId = existingRecordId;
          cloudflareZoneId = existingZoneId;
        } else {
          cloudflareRecordId = yield* upsertCloudflareDnsRecord({
            owner: recordSet.owner,
            provide,
            record: {
              content: record.value,
              name: record.name,
              priority: record.priority,
              type: record.recordType,
            },
            rootDomain: config.rootDomain,
            zoneId,
          });
          cloudflareZoneId = zoneId;
        }
      } else {
        cloudflareRecordId = yield* upsertCloudflareDnsRecord({
          owner: recordSet.owner,
          provide,
          record: {
            content: record.value,
            name: record.name,
            priority: record.priority,
            type: record.recordType,
          },
          rootDomain: config.rootDomain,
          zoneId,
        });
        cloudflareZoneId = zoneId;
      }
    }

    const values = {
      cloudflareRecordId,
      cloudflareZoneId,
      customDomainId: recordSet.customDomainId ?? null,
      lastCheckedAt: now,
      name: record.name,
      owner: recordSet.owner,
      priority: record.priority ?? null,
      purpose: record.purpose,
      recordType: record.recordType,
      role: record.role,
      sandboxDomainId: recordSet.sandboxDomainId ?? null,
      status,
      value: record.value,
    } satisfies typeof emailDnsRecord.$inferInsert;

    if (existing) {
      yield* db
        .update(emailDnsRecord)
        .set(values)
        .where(eq(emailDnsRecord.id, existing.id))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ManagedDnsError({
                cause,
                message: "Failed to update managed DNS record.",
                operation: "persist",
                owner: recordSet.owner,
                recordName: record.name,
              })
          )
        );
      return;
    }

    yield* db
      .insert(emailDnsRecord)
      .values(values)
      .pipe(
        Effect.mapError(
          (cause) =>
            new ManagedDnsError({
              cause,
              message: "Failed to insert managed DNS record.",
              operation: "persist",
              owner: recordSet.owner,
              recordName: record.name,
            })
        )
      );
  });

const makeManagedDnsService = (
  db: Database,
  config: EmailManagedDnsConfig | null,
  provide: ProvideCloudflare | null
): EmailManagedDnsService => {
  const reconcile = (recordSet: ManagedDnsRecordSet) =>
    Effect.gen(function* () {
      const zoneId = recordSet.cloudflareZoneId ?? config?.zoneId;
      const desiredKeys = new Set(
        recordSet.records.map((record) => recordKey(record))
      );

      for (const record of recordSet.records) {
        yield* upsertManagedRecord({
          config,
          db,
          provide,
          record,
          recordSet,
          zoneId,
        });
      }

      const owned = yield* db
        .select()
        .from(emailDnsRecord)
        .where(eq(emailDnsRecord.owner, recordSet.owner))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ManagedDnsError({
                cause,
                message: "Failed to list managed DNS records for owner.",
                operation: "persist",
                owner: recordSet.owner,
              })
          )
        );

      const extras = owned.filter((row) => !desiredKeys.has(recordKey(row)));

      if (extras.length === 0) {
        return;
      }

      if (provide) {
        yield* deleteCloudflareRecords(provide, extras, recordSet.owner);
      }

      yield* db
        .delete(emailDnsRecord)
        .where(
          inArray(
            emailDnsRecord.id,
            extras.map((row) => row.id)
          )
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ManagedDnsError({
                cause,
                message: "Failed to delete extra managed DNS records.",
                operation: "persist",
                owner: recordSet.owner,
              })
          )
        );
    }).pipe(
      Effect.mapError((cause) => {
        switch (cause._tag) {
          case "ManagedDnsError":
            return cause;
          default:
            return new ManagedDnsError({
              cause,
              message: "Managed DNS reconcile failed.",
              operation: "reconcile",
              owner: recordSet.owner,
            });
        }
      })
    );

  const remove = (owner: string) =>
    Effect.gen(function* () {
      const owned = yield* db
        .select()
        .from(emailDnsRecord)
        .where(eq(emailDnsRecord.owner, owner))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ManagedDnsError({
                cause,
                message: "Failed to list managed DNS records for owner.",
                operation: "persist",
                owner,
              })
          )
        );

      if (owned.length === 0) {
        return;
      }

      if (provide) {
        yield* deleteCloudflareRecords(
          provide,
          owned.filter((row) => row.cloudflareRecordId !== null),
          owner
        );
      }

      yield* db
        .delete(emailDnsRecord)
        .where(eq(emailDnsRecord.owner, owner))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ManagedDnsError({
                cause,
                message: "Failed to delete managed DNS records for owner.",
                operation: "persist",
                owner,
              })
          )
        );
    }).pipe(
      Effect.mapError((cause) => {
        switch (cause._tag) {
          case "ManagedDnsError":
            return cause;
          default:
            return new ManagedDnsError({
              cause,
              message: "Managed DNS remove failed.",
              operation: "remove",
              owner,
            });
        }
      })
    );

  return {
    cloudflareEnabled: config !== null,
    reconcile,
    remove,
  };
};

export class EmailManagedDns extends Context.Service<
  EmailManagedDns,
  EmailManagedDnsService
>()("Channels/EmailManagedDns") {
  /** No Cloudflare; reconcile/remove still persist and clean DB rows by owner. */
  static noop() {
    return Layer.effect(
      EmailManagedDns,
      Effect.gen(function* () {
        const db = yield* DB;
        return makeManagedDnsService(db, null, null);
      })
    );
  }

  static live(config: EmailManagedDnsConfig) {
    const credentialsLive = fromApiToken({ apiToken: config.apiToken });

    return Layer.effect(
      EmailManagedDns,
      Effect.gen(function* () {
        const db = yield* DB;
        const http = yield* HttpClient.HttpClient;
        const provide: ProvideCloudflare = (effect) =>
          effect.pipe(
            Effect.provide(credentialsLive),
            Effect.provideService(HttpClient.HttpClient, http)
          );

        return makeManagedDnsService(db, config, provide);
      })
    ).pipe(Layer.provide(FetchHttpClient.layer));
  }
}
