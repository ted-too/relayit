import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  type CustomDomain,
  customDomain,
  type DomainVerificationStatus,
  type EmailDomainRegistration,
  emailDnsRecord,
  emailDomainRegistration,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import { ownershipChallengeHost, ownershipChallengeValue } from "../custom-domain/dns";
import { completeDomainClaimTransfer } from "../custom-domain/lifecycle";
import { DnsLookups } from "../dns-lookups";
import { computeNextCheckAt, defaultVerifyCadenceConfig, mergeVerificationStatus } from "./cadence";

export class VerifyCustomDomainError extends Data.TaggedError("VerifyCustomDomainError")<{
  readonly cause?: unknown;
  readonly customDomainId?: string;
  readonly identityId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "dns" | "persist" | "status" | "claim";
  readonly organizationId?: string;
}> {}

export interface CustomDomainVerifyResult {
  readonly activeRecords: number;
  readonly customDomainId: string;
  readonly missingRecords: number;
  readonly nextCheckAt: Date;
  readonly verificationStatus: DomainVerificationStatus;
}

const verifyCustomDomainDnsRecords = (db: DatabaseExecutor, customDomainId: string) =>
  Effect.gen(function* () {
    const dnsLookups = yield* DnsLookups;
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
            }),
        ),
      );

    for (const record of records) {
      const evaluation = yield* Effect.tryPromise({
        catch: (cause) =>
          new VerifyCustomDomainError({
            cause,
            customDomainId,
            message: "Live DNS lookup failed.",
            operation: "dns",
          }),
        try: () => dnsLookups.evaluate(record),
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
              new VerifyCustomDomainError({
                cause,
                customDomainId,
                message: "Failed to update DNS record status.",
                operation: "persist",
              }),
          ),
        );
    }

    return { activeRecords, missingRecords };
  });

/**
 * Asks SES how the domain's identity stands, checks its DNS records, and rolls both up
 * into the domain's status and next check.
 */
export const verifyCustomDomainRegistration = (input: {
  readonly db: DatabaseExecutor;
  readonly domain: Pick<CustomDomain, "fqdn" | "id" | "verifyBackoffLevel">;
  readonly registration: EmailDomainRegistration;
}) =>
  Effect.gen(function* () {
    const backend = yield* EmailBackend;
    const customDomainId = input.domain.id;

    const identityStatus = yield* backend
      .getIdentityStatus({ fqdn: input.domain.fqdn, region: input.registration.region })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId,
              message: "Failed to read the SES identity status.",
              operation: "status",
            }),
        ),
      );

    const registrationStatus = mergeVerificationStatus({
      activeRecords: identityStatus.verified ? 1 : 0,
      missingRecords: identityStatus.verified ? 0 : 1,
      sesDkimVerified: identityStatus.dkimVerified,
      sesVerified: identityStatus.verified,
    });

    yield* input.db
      .update(emailDomainRegistration)
      .set({ verificationStatus: registrationStatus })
      .where(eq(emailDomainRegistration.id, input.registration.id))
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId,
              message: "Failed to update the registration's verification state.",
              operation: "persist",
            }),
        ),
      );

    const dns = yield* verifyCustomDomainDnsRecords(input.db, customDomainId);
    const verificationStatus = mergeVerificationStatus({
      activeRecords: dns.activeRecords,
      missingRecords: dns.missingRecords,
      sesDkimVerified: registrationStatus === "verified",
      sesVerified: registrationStatus !== "not_verified",
    });

    const now = new Date();
    const cadence = computeNextCheckAt({
      backoffLevel: input.domain.verifyBackoffLevel,
      config: defaultVerifyCadenceConfig,
      from: now,
      // SES can lag the DNS records: poll at the pace of whichever is further behind.
      verificationStatus:
        registrationStatus === "verified" ? verificationStatus : registrationStatus,
    });

    yield* input.db
      .update(customDomain)
      .set({
        lastCheckedAt: now,
        nextVerifyAt: cadence.nextCheckAt,
        verificationStatus,
        verifyBackoffLevel: cadence.backoffLevel,
      })
      .where(eq(customDomain.id, customDomainId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId,
              message: "Failed to update custom domain verification state.",
              operation: "persist",
            }),
        ),
      );

    return {
      activeRecords: dns.activeRecords,
      customDomainId,
      missingRecords: dns.missingRecords,
      nextCheckAt: cadence.nextCheckAt,
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
            }),
        ),
      );

    if (!link) {
      return yield* new VerifyCustomDomainError({
        customDomainId: input.customDomain.id,
        message: "Organization is not linked to this domain.",
        operation: "persist",
        organizationId: input.organizationId,
      });
    }

    const dnsLookups = yield* DnsLookups;
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
        const evaluation = await dnsLookups.evaluate({
          name: ownershipChallengeHost(input.customDomain.fqdn),
          recordType: "TXT",
          value: ownershipChallengeValue(link.ownershipToken),
        });
        return evaluation.matches;
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
          ownershipVerified && !link.ownershipEverVerifiedAt ? now : link.ownershipEverVerifiedAt,
        ownershipLastCheckedAt: now,
        ownershipNextVerifyAt: cadence.nextCheckAt,
        ownershipVerificationStatus,
      })
      .where(
        and(
          eq(organizationDomain.organizationId, input.organizationId),
          eq(organizationDomain.customDomainId, input.customDomain.id),
        ),
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
            }),
        ),
      );

    // A link starts unverified only as a claim, so proving it takes the Domain.
    if (ownershipVerified && link.ownershipVerificationStatus !== "verified") {
      yield* completeDomainClaimTransfer({
        customDomain: input.customDomain,
        db: input.db,
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
            }),
        ),
      );
    }

    return {
      customDomainId: input.customDomain.id,
      nextCheckAt: cadence.nextCheckAt,
      organizationId: input.organizationId,
      ownershipVerificationStatus,
    };
  });
