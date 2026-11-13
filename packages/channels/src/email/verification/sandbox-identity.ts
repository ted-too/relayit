import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  type DomainVerificationStatus,
  type EmailDomainRegistration,
  emailDnsRecord,
  emailDomainRegistration,
  type SandboxDomain,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import { DnsLookups } from "../dns-lookups";
import { computeNextCheckAt, defaultVerifyCadenceConfig, mergeVerificationStatus } from "./cadence";

export class VerifySandboxDomainError extends Data.TaggedError("VerifySandboxDomainError")<{
  readonly cause?: unknown;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "dns" | "persist" | "status";
  readonly sandboxDomainId?: string;
}> {}

export interface SandboxVerifyResult {
  readonly activeRecords: number;
  readonly missingRecords: number;
  readonly nextCheckAt: Date;
  readonly sandboxDomainId: string;
  readonly verificationStatus: DomainVerificationStatus;
}

const verifySandboxDnsRecords = (db: DatabaseExecutor, sandboxDomainId: string) =>
  Effect.gen(function* () {
    const dnsLookups = yield* DnsLookups;
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
            new VerifySandboxDomainError({
              cause,
              message: "Failed to list sandbox DNS records.",
              operation: "dns",
              sandboxDomainId,
            }),
        ),
      );

    for (const record of records) {
      const evaluation = yield* Effect.tryPromise({
        catch: (cause) =>
          new VerifySandboxDomainError({
            cause,
            message: "Live DNS lookup failed.",
            operation: "dns",
            sandboxDomainId,
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
              new VerifySandboxDomainError({
                cause,
                message: "Failed to update DNS record status.",
                operation: "persist",
                sandboxDomainId,
              }),
          ),
        );
    }

    return { activeRecords, missingRecords };
  });

/**
 * Asks SES how the sandbox root's identity stands, checks its DNS records, and rolls both
 * up into its status. It can be allocated to Projects only once both are verified.
 */
export const verifySandboxDomainRegistration = (input: {
  readonly db: DatabaseExecutor;
  readonly registration: EmailDomainRegistration;
  readonly sandboxDomain: Pick<SandboxDomain, "id" | "rootDomain" | "verifyBackoffLevel">;
}) =>
  Effect.gen(function* () {
    const backend = yield* EmailBackend;
    const sandboxDomainId = input.sandboxDomain.id;

    const identityStatus = yield* backend
      .getIdentityStatus({
        fqdn: input.sandboxDomain.rootDomain,
        region: input.registration.region,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifySandboxDomainError({
              cause,
              message: "Failed to read the SES identity status.",
              operation: "status",
              sandboxDomainId,
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
            new VerifySandboxDomainError({
              cause,
              message: "Failed to update the registration's verification state.",
              operation: "persist",
              sandboxDomainId,
            }),
        ),
      );

    const dns = yield* verifySandboxDnsRecords(input.db, sandboxDomainId);
    const verificationStatus = mergeVerificationStatus({
      activeRecords: dns.activeRecords,
      missingRecords: dns.missingRecords,
      sesDkimVerified: registrationStatus === "verified",
      sesVerified: registrationStatus !== "not_verified",
    });

    const now = new Date();
    const cadence = computeNextCheckAt({
      backoffLevel: input.sandboxDomain.verifyBackoffLevel,
      config: defaultVerifyCadenceConfig,
      from: now,
      // SES can lag the DNS records: poll at the pace of whichever is further behind.
      verificationStatus:
        registrationStatus === "verified" ? verificationStatus : registrationStatus,
    });

    yield* input.db
      .update(sandboxDomain)
      .set({
        isActive: verificationStatus === "verified" && registrationStatus === "verified",
        lastCheckedAt: now,
        nextVerifyAt: cadence.nextCheckAt,
        verificationStatus,
        verifyBackoffLevel: cadence.backoffLevel,
      })
      .where(eq(sandboxDomain.id, sandboxDomainId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifySandboxDomainError({
              cause,
              message: "Failed to update sandbox verification state.",
              operation: "persist",
              sandboxDomainId,
            }),
        ),
      );

    return {
      activeRecords: dns.activeRecords,
      missingRecords: dns.missingRecords,
      nextCheckAt: cadence.nextCheckAt,
      sandboxDomainId,
      verificationStatus,
    } satisfies SandboxVerifyResult;
  });
