import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  type DomainVerificationStatus,
  type EmailDomainProviderIdentity,
  emailDnsRecord,
  emailDomainProviderIdentity,
  type Provider,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { makeProviderTypeId } from "../../provider-type";
import { EmailProviderRegistry } from "../provider-registry";
import {
  computeNextCheckAt,
  defaultVerifyCadenceConfig,
  mergeVerificationStatus,
} from "./cadence";
import { evaluateLiveDnsRecord } from "./live-dns";

export class VerifyIdentityError extends Data.TaggedError(
  "VerifyIdentityError"
)<{
  readonly cause?: unknown;
  readonly identityId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "dns" | "persist" | "provider" | "status";
  readonly sandboxDomainId?: string;
}> {}

export interface SandboxVerifyResult {
  readonly activeRecords: number;
  readonly identityId: string;
  readonly identityNextCheckAt: Date;
  readonly missingRecords: number;
  readonly nextCheckAt: Date | null;
  readonly sandboxDomainId: string;
  readonly verificationStatus: DomainVerificationStatus;
}

const rollupDomainVerificationStatus = (
  identities: readonly Pick<
    EmailDomainProviderIdentity,
    "isActive" | "verificationStatus"
  >[],
  dns: { activeRecords: number; missingRecords: number }
): DomainVerificationStatus => {
  const activeIdentities = identities.filter((identity) => identity.isActive);
  const anyVerified = activeIdentities.some(
    (identity) => identity.verificationStatus === "verified"
  );
  const anyPartial = activeIdentities.some(
    (identity) => identity.verificationStatus === "partially_verified"
  );

  let providerVerified = anyVerified;
  let providerDkimVerified = anyVerified;

  if (!anyVerified && anyPartial) {
    providerVerified = true;
    providerDkimVerified = false;
  }

  return mergeVerificationStatus({
    activeRecords: dns.activeRecords,
    missingRecords: dns.missingRecords,
    providerDkimVerified,
    providerVerified,
  });
};

const verifySandboxDnsRecords = (
  db: DatabaseExecutor,
  sandboxDomainId: string
) =>
  Effect.gen(function* () {
    const now = new Date();
    let activeRecords = 0;
    let missingRecords = 0;

    const records = yield* db.query.emailDnsRecord
      .findMany({
        where: { role: "direct", sandboxDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              message: "Failed to list sandbox DNS records.",
              operation: "dns",
              sandboxDomainId,
            })
        )
      );

    for (const record of records) {
      const evaluation = yield* Effect.tryPromise({
        catch: (cause) =>
          new VerifyIdentityError({
            cause,
            message: "Live DNS lookup failed.",
            operation: "dns",
            sandboxDomainId,
          }),
        try: () => evaluateLiveDnsRecord(record),
      });

      if (evaluation.matches) {
        activeRecords += 1;
      } else {
        missingRecords += 1;
      }

      let nextStatus: "active" | "missing" | "pending";
      if (evaluation.matches) {
        nextStatus = "active";
      } else if (record.status === "pending") {
        nextStatus = "pending";
      } else {
        nextStatus = "missing";
      }

      yield* db
        .update(emailDnsRecord)
        .set({
          lastCheckedAt: now,
          status: nextStatus,
          warnings: [...evaluation.warnings],
        })
        .where(eq(emailDnsRecord.id, record.id))
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyIdentityError({
                cause,
                message: "Failed to update DNS record status.",
                operation: "persist",
                sandboxDomainId,
              })
          )
        );
    }

    return { activeRecords, missingRecords };
  });

export const verifySandboxProviderIdentity = (input: {
  readonly db: DatabaseExecutor;
  readonly fqdn: string;
  readonly identity: EmailDomainProviderIdentity;
  readonly provider: Provider;
  readonly sandboxDomainId: string;
}) =>
  Effect.gen(function* () {
    const credentialsVault = yield* ProviderCredentialsVault;
    const providers = yield* EmailProviderRegistry;

    const factory = yield* providers
      .get(
        makeProviderTypeId(input.provider.vendorId, input.provider.productId)
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              identityId: input.identity.id,
              message: "Email provider type is not registered.",
              operation: "provider",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    const credentials = yield* credentialsVault
      .open(input.provider.credentials)
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              identityId: input.identity.id,
              message: "Failed to open provider credentials.",
              operation: "provider",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    const adapter = yield* factory
      .create({
        credentials,
        providerId: input.provider.id,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              identityId: input.identity.id,
              message: "Failed to create email provider adapter.",
              operation: "provider",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    const identityStatus = yield* adapter
      .getIdentityStatus({ fqdn: input.fqdn })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              identityId: input.identity.id,
              message: "Failed to read provider identity status.",
              operation: "status",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    const identityVerificationStatus = mergeVerificationStatus({
      activeRecords: identityStatus.verified ? 1 : 0,
      missingRecords: identityStatus.verified ? 0 : 1,
      providerDkimVerified: identityStatus.dkimVerified,
      providerVerified: identityStatus.verified,
    });

    const now = new Date();
    const identityCadence = computeNextCheckAt({
      backoffLevel: input.identity.verifyBackoffLevel,
      config: defaultVerifyCadenceConfig,
      from: now,
      verificationStatus: identityVerificationStatus,
    });

    yield* input.db
      .update(emailDomainProviderIdentity)
      .set({
        lastCheckedAt: now,
        nextVerifyAt: identityCadence.nextCheckAt,
        verificationStatus: identityVerificationStatus,
        verifyBackoffLevel: identityCadence.backoffLevel,
      })
      .where(eq(emailDomainProviderIdentity.id, input.identity.id))
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              identityId: input.identity.id,
              message: "Failed to update identity verification state.",
              operation: "persist",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    const dns = yield* verifySandboxDnsRecords(input.db, input.sandboxDomainId);

    const identities = yield* input.db.query.emailDomainProviderIdentity
      .findMany({
        where: { sandboxDomainId: input.sandboxDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              message: "Failed to list sandbox identities for rollup.",
              operation: "persist",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    const verificationStatus = rollupDomainVerificationStatus(identities, dns);

    const sandbox = yield* input.db.query.sandboxDomain
      .findFirst({
        columns: { verifyBackoffLevel: true },
        where: { id: input.sandboxDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              message: "Failed to load sandbox domain backoff.",
              operation: "persist",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    const domainCadence = computeNextCheckAt({
      backoffLevel: sandbox?.verifyBackoffLevel ?? 0,
      config: defaultVerifyCadenceConfig,
      from: now,
      verificationStatus,
    });

    const isActive =
      verificationStatus === "verified" &&
      identities.some(
        (row) => row.isActive && row.verificationStatus === "verified"
      );

    yield* input.db
      .update(sandboxDomain)
      .set({
        isActive,
        lastCheckedAt: now,
        nextVerifyAt: domainCadence.nextCheckAt,
        verificationStatus,
        verifyBackoffLevel: domainCadence.backoffLevel,
      })
      .where(eq(sandboxDomain.id, input.sandboxDomainId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyIdentityError({
              cause,
              message: "Failed to update sandbox verification state.",
              operation: "persist",
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );

    return {
      activeRecords: dns.activeRecords,
      identityId: input.identity.id,
      identityNextCheckAt: identityCadence.nextCheckAt,
      missingRecords: dns.missingRecords,
      nextCheckAt: domainCadence.nextCheckAt,
      sandboxDomainId: input.sandboxDomainId,
      verificationStatus,
    } satisfies SandboxVerifyResult;
  });
