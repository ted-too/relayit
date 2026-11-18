import type { Database, DatabaseExecutor } from "@repo/persistence/db/effect";
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
import {
  CLAIM_TTL_MS,
  completeDomainClaimTransfer,
  removeDomainLink,
} from "../custom-domain/lifecycle";
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

/**
 * Checks a claim's TXT record and, once it is published, gives the claiming Project the
 * Domain. A link already proven stays proven: the holder may remove the record afterwards.
 */
export const verifyCustomDomainOwnership = (input: {
  readonly customDomain: CustomDomain;
  readonly db: Database;
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

    // Another claim took the Domain, or the Project removed its own: nothing left to check.
    if (!link) {
      return {
        customDomainId: input.customDomain.id,
        organizationId: input.organizationId,
        ownershipVerificationStatus: "superseded" as const,
      };
    }

    if (link.ownershipVerificationStatus === "verified") {
      return {
        customDomainId: input.customDomain.id,
        organizationId: input.organizationId,
        ownershipVerificationStatus: "verified" as const,
      };
    }

    if (Date.now() - new Date(link.createdAt).getTime() > CLAIM_TTL_MS) {
      // A refresh that proved the claim a moment ago keeps it. A Domain this was the last
      // link to goes with it.
      yield* removeDomainLink({
        customDomainId: input.customDomain.id,
        db: input.db,
        organizationId: input.organizationId,
        unprovenOnly: true,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainError({
              cause,
              customDomainId: input.customDomain.id,
              message: "Failed to remove a lapsed claim.",
              operation: "claim",
              organizationId: input.organizationId,
            }),
        ),
      );
      return {
        customDomainId: input.customDomain.id,
        organizationId: input.organizationId,
        ownershipVerificationStatus: "lapsed" as const,
      };
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

    const now = new Date();
    const cadence = computeNextCheckAt({
      backoffLevel: link.ownershipBackoffLevel,
      config: defaultVerifyCadenceConfig,
      from: now,
      verificationStatus: ownershipVerified ? "verified" : "not_verified",
    });
    const checked = {
      ownershipBackoffLevel: cadence.backoffLevel,
      ownershipLastCheckedAt: now,
      ownershipNextVerifyAt: cadence.nextCheckAt,
    };

    // A link starts unverified only as a claim, so proving it takes the Domain.
    if (ownershipVerified) {
      const took = yield* completeDomainClaimTransfer({
        customDomainId: input.customDomain.id,
        db: input.db,
        organizationId: input.organizationId,
        proof: { ...checked, ownershipEverVerifiedAt: now },
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
      return {
        customDomainId: input.customDomain.id,
        organizationId: input.organizationId,
        ownershipVerificationStatus: took ? ("verified" as const) : ("superseded" as const),
      };
    }

    yield* input.db
      .update(organizationDomain)
      .set(checked)
      .where(
        and(
          eq(organizationDomain.organizationId, input.organizationId),
          eq(organizationDomain.customDomainId, input.customDomain.id),
          // A check running beside one that proved the claim leaves the proof alone.
          eq(organizationDomain.ownershipVerificationStatus, "not_verified"),
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

    return {
      customDomainId: input.customDomain.id,
      nextCheckAt: cadence.nextCheckAt,
      organizationId: input.organizationId,
      ownershipVerificationStatus: "not_verified" as const,
    };
  });
