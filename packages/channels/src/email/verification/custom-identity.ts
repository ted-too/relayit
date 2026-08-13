import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  type CustomDomain,
  customDomain,
  type DomainVerificationStatus,
  type EmailDomainProviderIdentity,
  emailDnsRecord,
  emailDomainProviderIdentity,
  organizationDomain,
  type Provider,
} from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { makeProviderTypeId } from "../../provider-type";
import {
  ownershipChallengeHost,
  ownershipChallengeValue,
} from "../custom-domain/dns";
import { completeDomainClaimTransfer } from "../custom-domain/lifecycle";
import { EmailProviderRegistry } from "../provider-registry";
import {
  computeNextCheckAt,
  defaultVerifyCadenceConfig,
  mergeVerificationStatus,
} from "./cadence";
import {
  lookupTxtRecords,
  recordMatchesLiveDns,
  txtRecordsIncludeValue,
} from "./live-dns";

export class VerifyCustomDomainError extends Data.TaggedError(
  "VerifyCustomDomainError"
)<{
  readonly cause?: unknown;
  readonly customDomainId?: string;
  readonly identityId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "dns" | "persist" | "provider" | "status" | "claim";
  readonly organizationId?: string;
}> {}

export interface CustomDomainVerifyResult {
  readonly activeRecords: number;
  readonly customDomainId: string;
  readonly identityId: string;
  readonly identityNextCheckAt: Date;
  readonly missingRecords: number;
  readonly nextCheckAt: Date | null;
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

const verifyCustomDomainDnsRecords = (
  db: DatabaseExecutor,
  customDomainId: string
) =>
  Effect.gen(function* () {
    const now = new Date();
    let activeRecords = 0;
    let missingRecords = 0;

    const records = yield* db.query.emailDnsRecord
      .findMany({
        where: { customDomainId, role: "direct" },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId,
              message: "Failed to list custom domain DNS records.",
              operation: "dns",
            })
        )
      );

    for (const record of records) {
      const matches = yield* Effect.tryPromise({
        catch: (cause) =>
          new VerifyCustomDomainError({
            cause,
            customDomainId,
            message: "Live DNS lookup failed.",
            operation: "dns",
          }),
        try: () => recordMatchesLiveDns(record),
      });

      if (matches) {
        activeRecords += 1;
      } else {
        missingRecords += 1;
      }

      let nextStatus: "active" | "missing" | "pending";
      if (matches) {
        nextStatus = "active";
      } else if (record.status === "pending") {
        nextStatus = "pending";
      } else {
        nextStatus = "missing";
      }

      yield* db
        .update(emailDnsRecord)
        .set({ lastCheckedAt: now, status: nextStatus })
        .where(eq(emailDnsRecord.id, record.id))
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyCustomDomainError({
                cause,
                customDomainId,
                message: "Failed to update DNS record status.",
                operation: "persist",
              })
          )
        );
    }

    return { activeRecords, missingRecords };
  });

export const verifyCustomDomainProviderIdentity = (input: {
  readonly customDomainId: string;
  readonly db: DatabaseExecutor;
  readonly fqdn: string;
  readonly identity: EmailDomainProviderIdentity;
  readonly provider: Provider;
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
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              identityId: input.identity.id,
              message: "Email provider type is not registered.",
              operation: "provider",
            })
        )
      );

    const credentials = yield* credentialsVault
      .open(input.provider.credentials)
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              identityId: input.identity.id,
              message: "Failed to open provider credentials.",
              operation: "provider",
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
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              identityId: input.identity.id,
              message: "Failed to create email provider adapter.",
              operation: "provider",
            })
        )
      );

    const identityStatus = yield* adapter
      .getIdentityStatus({ fqdn: input.fqdn })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              identityId: input.identity.id,
              message: "Failed to read provider identity status.",
              operation: "status",
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
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              identityId: input.identity.id,
              message: "Failed to update identity verification state.",
              operation: "persist",
            })
        )
      );

    const dns = yield* verifyCustomDomainDnsRecords(
      input.db,
      input.customDomainId
    );

    const identities = yield* input.db.query.emailDomainProviderIdentity
      .findMany({
        where: { customDomainId: input.customDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to list custom domain identities for rollup.",
              operation: "persist",
            })
        )
      );

    const verificationStatus = rollupDomainVerificationStatus(identities, dns);

    const domain = yield* input.db.query.customDomain
      .findFirst({
        columns: { verifyBackoffLevel: true },
        where: { id: input.customDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to load custom domain backoff.",
              operation: "persist",
            })
        )
      );

    const domainCadence = computeNextCheckAt({
      backoffLevel: domain?.verifyBackoffLevel ?? 0,
      config: defaultVerifyCadenceConfig,
      from: now,
      verificationStatus,
    });

    yield* input.db
      .update(customDomain)
      .set({
        lastCheckedAt: now,
        nextVerifyAt: domainCadence.nextCheckAt,
        verificationStatus,
        verifyBackoffLevel: domainCadence.backoffLevel,
      })
      .where(eq(customDomain.id, input.customDomainId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to update custom domain verification state.",
              operation: "persist",
            })
        )
      );

    return {
      activeRecords: dns.activeRecords,
      customDomainId: input.customDomainId,
      identityId: input.identity.id,
      identityNextCheckAt: identityCadence.nextCheckAt,
      missingRecords: dns.missingRecords,
      nextCheckAt: domainCadence.nextCheckAt,
      verificationStatus,
    } satisfies CustomDomainVerifyResult;
  });

export const verifyCustomDomainOwnership = (input: {
  readonly customDomain: CustomDomain;
  readonly db: DatabaseExecutor;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const link = yield* input.db.query.organizationDomain
      .findFirst({
        where: {
          customDomainId: input.customDomain.id,
          organizationId: input.organizationId,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomain.id,
              message: "Failed to load ownership link.",
              operation: "persist",
              organizationId: input.organizationId,
            })
        )
      );

    if (!link) {
      return yield* new VerifyCustomDomainError({
        customDomainId: input.customDomain.id,
        message: "Organization is not linked to this domain.",
        operation: "persist",
        organizationId: input.organizationId,
      });
    }

    const ownershipVerified = yield* Effect.tryPromise({
      catch: (cause) =>
        new VerifyCustomDomainError({
          cause,
          customDomainId: input.customDomain.id,
          message: "Ownership DNS lookup failed.",
          operation: "dns",
          organizationId: input.organizationId,
        }),
      try: async () => {
        const records = await lookupTxtRecords(
          ownershipChallengeHost(input.customDomain.fqdn)
        );
        return txtRecordsIncludeValue(
          records,
          ownershipChallengeValue(link.ownershipToken)
        );
      },
    });

    const ownershipVerificationStatus = ownershipVerified
      ? ("verified" as const)
      : ("not_verified" as const);

    const now = new Date();
    const cadence = computeNextCheckAt({
      backoffLevel: link.ownershipBackoffLevel,
      config: defaultVerifyCadenceConfig,
      from: now,
      verificationStatus: ownershipVerified ? "verified" : "not_verified",
    });

    yield* input.db
      .update(organizationDomain)
      .set({
        ownershipBackoffLevel: cadence.backoffLevel,
        ownershipEverVerifiedAt:
          ownershipVerified && !link.ownershipEverVerifiedAt
            ? now
            : link.ownershipEverVerifiedAt,
        ownershipLastCheckedAt: now,
        ownershipNextVerifyAt: cadence.nextCheckAt,
        ownershipVerificationStatus,
        pendingProviderId: ownershipVerified ? null : link.pendingProviderId,
      })
      .where(
        and(
          eq(organizationDomain.organizationId, input.organizationId),
          eq(organizationDomain.customDomainId, input.customDomain.id)
        )
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomain.id,
              message: "Failed to update ownership verification state.",
              operation: "persist",
              organizationId: input.organizationId,
            })
        )
      );

    if (ownershipVerified && link.pendingProviderId) {
      yield* completeDomainClaimTransfer({
        customDomain: input.customDomain,
        db: input.db,
        keepProviderId: link.pendingProviderId,
        organizationId: input.organizationId,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomain.id,
              message: "Failed to complete domain claim transfer.",
              operation: "claim",
              organizationId: input.organizationId,
            })
        )
      );
    }

    return {
      customDomainId: input.customDomain.id,
      nextCheckAt: cadence.nextCheckAt,
      organizationId: input.organizationId,
      ownershipVerificationStatus,
    };
  });
