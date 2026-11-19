import { Jobs } from "@repo/jobs";
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
import { domainUpdatedColumns, emitDomainUpdated } from "../deliverability/project-sending-pause";
import { DnsLookups } from "../dns-lookups";
import {
  computeNextCheckAt,
  computeNextDomainCheckAt,
  defaultVerifyCadenceConfig,
  domainChecksStopped,
  mergeVerificationStatus,
} from "./cadence";
import { emailVerifyCustomDomainJob } from "./jobs";

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
  /** Null when the Domain stayed unverified until its checks stopped, or is gone. */
  readonly nextCheckAt: Date | null;
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
 * into the domain's status and next check. A Domain left unverified is checked less and
 * less often and then not at all (`UNVERIFIED_DOMAIN_CHECKS`); the check that stops them
 * tells the Project holding it (`domain.updated`), and nothing is removed. `restart` is the
 * holder asking: the count of unverified checks starts again, and with it the checks.
 */
export const verifyCustomDomainRegistration = (input: {
  readonly db: Database;
  readonly domain: Pick<CustomDomain, "fqdn" | "id">;
  readonly registration: EmailDomainRegistration;
  readonly restart?: boolean;
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
    const nextCheckAt = yield* input.db
      .transaction((tx) =>
        Effect.gen(function* () {
          // Counted from the row as it is now, held: a refresh or a proven claim may have
          // started the count again while SES and DNS were being asked, and a check that
          // wrote what it read before would undo that, or tell a new holder of a stop.
          const [current] = yield* tx
            .select({
              lastCheckedAt: customDomain.lastCheckedAt,
              nextVerifyAt: customDomain.nextVerifyAt,
              verifyBackoffLevel: customDomain.verifyBackoffLevel,
            })
            .from(customDomain)
            .where(eq(customDomain.id, customDomainId))
            .for("update");
          // Removed while it was being checked: nothing to write, and no next check.
          if (!current) {
            return null;
          }
          const cadence = computeNextDomainCheckAt({
            from: now,
            unverifiedChecks: input.restart ? 0 : current.verifyBackoffLevel,
            // SES can lag the DNS records: poll at the pace of whichever is further behind.
            verificationStatus:
              registrationStatus === "verified" ? verificationStatus : registrationStatus,
          });
          const [checked] = yield* tx
            .update(customDomain)
            .set({
              lastCheckedAt: now,
              nextVerifyAt: cadence.nextCheckAt,
              verificationStatus,
              verifyBackoffLevel: cadence.unverifiedChecks,
            })
            .where(eq(customDomain.id, customDomainId))
            .returning(domainUpdatedColumns);
          // Told once, by the check that stops them: one that finds them already stopped
          // changes nothing.
          if (checked && cadence.nextCheckAt === null && !domainChecksStopped(current)) {
            const holders = yield* tx
              .select({ organizationId: organizationDomain.organizationId })
              .from(organizationDomain)
              .where(
                and(
                  eq(organizationDomain.customDomainId, customDomainId),
                  eq(organizationDomain.ownershipVerificationStatus, "verified"),
                ),
              );
            yield* Effect.forEach(
              holders,
              ({ organizationId }) => emitDomainUpdated(tx, organizationId, checked),
              { discard: true },
            );
          }
          return cadence.nextCheckAt;
        }),
      )
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
      nextCheckAt,
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
      if (took) {
        // The Domain's checks may have stopped while its last holder left it unverified,
        // and its new holder has asked for nothing but the Domain: the transfer made a
        // check due now, and this is its job. Lost, the worker's next start schedules it.
        yield* (yield* Jobs)
          .schedule(
            emailVerifyCustomDomainJob,
            { customDomainId: input.customDomain.id },
            now.getTime(),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyCustomDomainError({
                  cause,
                  customDomainId: input.customDomain.id,
                  message: "Failed to schedule the claimed Domain's verification.",
                  operation: "claim",
                  organizationId: input.organizationId,
                }),
            ),
          );
      }
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
