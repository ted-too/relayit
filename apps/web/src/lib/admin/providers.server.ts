import {
  emailProviderDeliveryWebhookUrl,
  ensureEmailProviderInfrastructure,
  teardownEmailProviderInfrastructure,
} from "@repo/channels/email/ensure-provider-infrastructure";
import {
  ensureSandboxForProvider,
  removeSandboxProviderIdentity,
  type SandboxDomainError,
} from "@repo/channels/email/sandbox";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { type DatabaseExecutor, DB } from "@repo/persistence/db/effect";
import { provider } from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import type {
  CreatePlatformProviderBody,
  UpdatePlatformProviderBody,
} from "./provider-schemas";
import type {
  PlatformProviderListItem,
  SerializableUnencryptedCredentials,
} from "./provider-types";

export class PlatformProviderError extends Data.TaggedError(
  "PlatformProviderError"
)<{
  readonly cause?: unknown;
  readonly code: "not_found" | "in_use" | "failed";
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
}> {}

export interface SandboxCloudflareConfig {
  readonly rootDomain: string;
  readonly zoneId: string;
}

const mapSandboxDomainError = (cause: SandboxDomainError) => {
  switch (cause.operation) {
    case "unavailable":
      return new PlatformProviderError({
        cause,
        code: "failed",
        message: "Sandbox Domains require Cloudflare to be configured.",
      });
    default:
      return new PlatformProviderError({
        cause,
        code: "failed",
        message: cause.message,
      });
  }
};

const toSerializableUnencrypted = (
  value: Record<string, unknown> | undefined
): SerializableUnencryptedCredentials => {
  const out: SerializableUnencryptedCredentials = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (typeof entry === "string") {
      out[key] = entry;
    } else if (entry != null) {
      out[key] = String(entry);
    }
  }
  return out;
};

const toListItem = (row: {
  channelType: "email";
  createdAt: Date;
  credentials: { unencrypted: Record<string, unknown> };
  id: string;
  isDefault: boolean;
  name: string | null;
  productId: string;
  scope: "platform" | "project";
  updatedAt: Date;
  vendorId: string;
}): PlatformProviderListItem => ({
  channelType: row.channelType,
  createdAt: row.createdAt,
  credentials: {
    unencrypted: toSerializableUnencrypted(row.credentials.unencrypted),
  },
  id: row.id,
  isDefault: row.isDefault,
  name: row.name,
  productId: row.productId,
  scope: row.scope,
  updatedAt: row.updatedAt,
  vendorId: row.vendorId,
});

export const listPlatformProviders = Effect.gen(function* () {
  const db = yield* DB;
  const rows = yield* db.query.provider
    .findMany({
      orderBy: { createdAt: "desc" },
      where: { channelType: "email", scope: "platform" },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new PlatformProviderError({
            cause,
            code: "failed",
            message: "Failed to list platform Providers.",
          })
      )
    );

  return rows.map(toListItem);
});

const clearEmailDefaults = (db: DatabaseExecutor) =>
  db
    .update(provider)
    .set({ isDefault: false })
    .where(
      and(eq(provider.scope, "platform"), eq(provider.channelType, "email"))
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new PlatformProviderError({
            cause,
            code: "failed",
            message: "Failed to clear default managed backends.",
          })
      )
    );

export const createPlatformProvider = (
  input: CreatePlatformProviderBody & {
    readonly apiOrigin: string;
    readonly sandboxCloudflare: SandboxCloudflareConfig | null;
  }
) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const vault = yield* ProviderCredentialsVault;

    const sealed = yield* vault.seal(input.credentials).pipe(
      Effect.mapError(
        (cause) =>
          new PlatformProviderError({
            cause,
            code: "failed",
            message: "Failed to seal Provider credentials.",
          })
      )
    );

    const makeDefault = input.isDefault === true;

    if (makeDefault) {
      yield* clearEmailDefaults(db);
    }

    const existingDefault = yield* db.query.provider
      .findFirst({
        columns: { id: true },
        where: {
          channelType: "email",
          isDefault: true,
          scope: "platform",
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to check existing default Provider.",
            })
        )
      );

    const [row] = yield* db
      .insert(provider)
      .values({
        channelType: "email",
        credentials: sealed,
        isDefault: makeDefault || !existingDefault,
        name: input.name,
        organizationId: null,
        productId: input.productId,
        scope: "platform",
        vendorId: input.vendorId,
      })
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to create platform Provider.",
            })
        )
      );

    if (!row) {
      return yield* new PlatformProviderError({
        code: "failed",
        message: "Failed to create platform Provider.",
      });
    }

    yield* ensureEmailProviderInfrastructure(row, {
      deliveryWebhookUrl: emailProviderDeliveryWebhookUrl(
        input.apiOrigin,
        row.vendorId,
        row.productId
      ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new PlatformProviderError({
            cause,
            code: "failed",
            message: "Failed to provision Provider infrastructure.",
          })
      )
    );

    yield* ensureSandboxForProvider({
      cloudflareZoneId: input.sandboxCloudflare?.zoneId ?? null,
      provider: row,
      rootDomain: input.sandboxCloudflare?.rootDomain ?? null,
    }).pipe(Effect.mapError(mapSandboxDomainError));

    return toListItem(row);
  });

export const updatePlatformProvider = (
  input: UpdatePlatformProviderBody & {
    readonly apiOrigin: string;
  }
) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const vault = yield* ProviderCredentialsVault;

    const existing = yield* db.query.provider
      .findFirst({
        where: { id: input.providerId, scope: "platform" },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to load platform Provider.",
            })
        )
      );

    if (!existing) {
      return yield* new PlatformProviderError({
        code: "not_found",
        message: "Provider not found.",
      });
    }

    let credentials = existing.credentials;
    if (input.credentials?.encrypted) {
      const merged = {
        encrypted: {
          ...((existing.credentials.encrypted as Record<string, string>) ?? {}),
          ...input.credentials.encrypted,
        },
        unencrypted: {
          ...((existing.credentials.unencrypted as Record<string, unknown>) ??
            {}),
          ...(input.credentials.unencrypted ?? {}),
        },
      };
      credentials = yield* vault.seal(merged).pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to seal Provider credentials.",
            })
        )
      );
    } else if (input.credentials?.unencrypted) {
      credentials = {
        ...existing.credentials,
        unencrypted: {
          ...((existing.credentials.unencrypted as Record<string, unknown>) ??
            {}),
          ...input.credentials.unencrypted,
        },
      };
    }

    if (input.isDefault === true) {
      yield* clearEmailDefaults(db);
    }

    const [row] = yield* db
      .update(provider)
      .set({
        credentials,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.isDefault === true ? { isDefault: true } : {}),
      })
      .where(eq(provider.id, input.providerId))
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to update platform Provider.",
            })
        )
      );

    if (!row) {
      return yield* new PlatformProviderError({
        code: "failed",
        message: "Failed to update platform Provider.",
      });
    }

    if (input.credentials) {
      yield* ensureEmailProviderInfrastructure(row, {
        deliveryWebhookUrl: emailProviderDeliveryWebhookUrl(
          input.apiOrigin,
          row.vendorId,
          row.productId
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to provision Provider infrastructure.",
            })
        )
      );
    }

    return toListItem(row);
  });

export const setDefaultPlatformProvider = (providerId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const existing = yield* db.query.provider
      .findFirst({
        columns: { id: true },
        where: {
          channelType: "email",
          id: providerId,
          scope: "platform",
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to load platform Provider.",
            })
        )
      );

    if (!existing) {
      return yield* new PlatformProviderError({
        code: "not_found",
        message: "Provider not found.",
      });
    }

    yield* clearEmailDefaults(db);
    yield* db
      .update(provider)
      .set({ isDefault: true })
      .where(eq(provider.id, providerId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to set default managed backend.",
            })
        )
      );

    return { id: providerId, isDefault: true as const };
  });

export const deletePlatformProvider = (providerId: string, apiOrigin: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const existing = yield* db.query.provider
      .findFirst({
        where: { id: providerId, scope: "platform" },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to load platform Provider.",
            })
        )
      );

    if (!existing) {
      return yield* new PlatformProviderError({
        code: "not_found",
        message: "Provider not found.",
      });
    }

    const customIdentity = yield* db.query.emailDomainProviderIdentity
      .findFirst({
        columns: { id: true },
        where: { customDomainId: { isNotNull: true }, providerId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to check Provider pairings.",
            })
        )
      );

    if (customIdentity) {
      return yield* new PlatformProviderError({
        code: "in_use",
        message: "Managed backend is still referenced by a Domain pairing.",
      });
    }

    yield* removeSandboxProviderIdentity(existing).pipe(
      Effect.mapError(mapSandboxDomainError)
    );

    yield* teardownEmailProviderInfrastructure(existing, {
      deliveryWebhookUrl: emailProviderDeliveryWebhookUrl(
        apiOrigin,
        existing.vendorId,
        existing.productId
      ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new PlatformProviderError({
            cause,
            code: "failed",
            message: "Failed to tear down Provider infrastructure.",
          })
      )
    );

    yield* db
      .delete(provider)
      .where(eq(provider.id, providerId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new PlatformProviderError({
              cause,
              code: "failed",
              message: "Failed to delete platform Provider.",
            })
        )
      );

    return { id: providerId };
  });
