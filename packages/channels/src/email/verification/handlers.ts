import { defineJobHandler, Jobs } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import { customDomain } from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { DnsLookups } from "../dns-lookups";
import { sweepIfSandboxAllocatable } from "../sandbox/allocate";
import { verifyCustomDomainOwnership, verifyCustomDomainRegistration } from "./custom-identity";
import {
  emailVerifyCustomDomainJob,
  emailVerifyOwnershipJob,
  emailVerifySandboxDomainJob,
} from "./jobs";
import { verifySandboxDomainRegistration } from "./sandbox-identity";

export class VerifySandboxDomainHandlerError extends Data.TaggedError(
  "VerifySandboxDomainHandlerError",
)<{
  readonly cause?: unknown;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "persist" | "schedule" | "sweep" | "verify";
  readonly sandboxDomainId?: string;
}> {}

export class VerifyCustomDomainHandlerError extends Data.TaggedError(
  "VerifyCustomDomainHandlerError",
)<{
  readonly cause?: unknown;
  readonly customDomainId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "persist" | "schedule" | "verify";
}> {}

export class VerifyOwnershipHandlerError extends Data.TaggedError("VerifyOwnershipHandlerError")<{
  readonly cause?: unknown;
  readonly customDomainId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "persist" | "schedule" | "verify";
  readonly organizationId?: string;
}> {}

export const emailVerifySandboxDomainHandler = defineJobHandler({
  classifyFailure: () => "retryable",
  contract: emailVerifySandboxDomainJob,
  handle: (payload) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const jobs = yield* Jobs;

      const sandbox = yield* db.query.sandboxDomain
        .findFirst({
          where: { id: payload.sandboxDomainId },
          with: { registration: true },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifySandboxDomainHandlerError({
                cause,
                message: "Failed to load sandbox domain for verify.",
                operation: "persist",
                sandboxDomainId: payload.sandboxDomainId,
              }),
          ),
        );

      if (!sandbox?.registration) {
        return;
      }

      const result = yield* verifySandboxDomainRegistration({
        db,
        registration: sandbox.registration,
        sandboxDomain: sandbox,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new VerifySandboxDomainHandlerError({
              cause,
              message: "Failed to verify the sandbox domain's registration.",
              operation: "verify",
              sandboxDomainId: sandbox.id,
            }),
        ),
      );

      yield* sweepIfSandboxAllocatable(sandbox.id).pipe(
        Effect.mapError(
          (cause) =>
            new VerifySandboxDomainHandlerError({
              cause,
              message: "Failed to sweep sandbox allocation after verify.",
              operation: "sweep",
              sandboxDomainId: sandbox.id,
            }),
        ),
      );

      yield* jobs
        .schedule(
          emailVerifySandboxDomainJob,
          { sandboxDomainId: sandbox.id },
          result.nextCheckAt.getTime(),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifySandboxDomainHandlerError({
                cause,
                message: "Failed to schedule next sandbox verify.",
                operation: "schedule",
                sandboxDomainId: sandbox.id,
              }),
          ),
        );
    }),
  reconcile: Effect.gen(function* () {
    const db = yield* DB;
    const jobs = yield* Jobs;
    const rows = yield* db.query.sandboxDomain
      .findMany({
        columns: { id: true, nextVerifyAt: true },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifySandboxDomainHandlerError({
              cause,
              message: "Failed to list sandbox domains for reconcile.",
              operation: "persist",
            }),
        ),
      );

    yield* Effect.forEach(
      rows.filter((row) => row.nextVerifyAt !== null),
      (row) =>
        jobs.schedule(
          emailVerifySandboxDomainJob,
          { sandboxDomainId: row.id },
          new Date(row.nextVerifyAt as Date | string).getTime(),
        ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerifySandboxDomainHandlerError({
            cause,
            message: "Failed to schedule sandbox verify reconcile.",
            operation: "schedule",
          }),
      ),
    );
  }),
});

export const emailVerifyCustomDomainHandler = defineJobHandler({
  classifyFailure: () => "retryable",
  contract: emailVerifyCustomDomainJob,
  handle: (payload) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const jobs = yield* Jobs;

      const domain = yield* db.query.customDomain
        .findFirst({
          where: { id: payload.customDomainId },
          with: { registration: true },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyCustomDomainHandlerError({
                cause,
                customDomainId: payload.customDomainId,
                message: "Failed to load custom domain for verify.",
                operation: "persist",
              }),
          ),
        );

      if (!domain) {
        return;
      }

      const dnsLookups = yield* DnsLookups;
      const detectedProvider = yield* Effect.tryPromise({
        catch: (cause) =>
          new VerifyCustomDomainHandlerError({
            cause,
            customDomainId: domain.id,
            message: "Failed to detect custom domain DNS host.",
            operation: "persist",
          }),
        try: () => dnsLookups.detectProvider(domain.fqdn),
      });

      if (detectedProvider !== domain.provider) {
        yield* db
          .update(customDomain)
          .set({ provider: detectedProvider })
          .where(eq(customDomain.id, domain.id))
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyCustomDomainHandlerError({
                  cause,
                  customDomainId: domain.id,
                  message: "Failed to persist detected DNS host.",
                  operation: "persist",
                }),
            ),
          );
      }

      if (!domain.registration) {
        return yield* jobs.cancel(emailVerifyCustomDomainJob, { customDomainId: domain.id }).pipe(
          Effect.mapError(
            (cause) =>
              new VerifyCustomDomainHandlerError({
                cause,
                customDomainId: domain.id,
                message: "Failed to cancel custom domain verify job.",
                operation: "schedule",
              }),
          ),
        );
      }

      const result = yield* verifyCustomDomainRegistration({
        db,
        domain,
        registration: domain.registration,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainHandlerError({
              cause,
              customDomainId: domain.id,
              message: "Failed to verify the custom domain's registration.",
              operation: "verify",
            }),
        ),
      );

      yield* jobs
        .schedule(
          emailVerifyCustomDomainJob,
          { customDomainId: domain.id },
          result.nextCheckAt.getTime(),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyCustomDomainHandlerError({
                cause,
                customDomainId: domain.id,
                message: "Failed to schedule next custom domain verify.",
                operation: "schedule",
              }),
          ),
        );
    }),
  reconcile: Effect.gen(function* () {
    const db = yield* DB;
    const jobs = yield* Jobs;
    const rows = yield* db.query.customDomain
      .findMany({
        columns: { id: true, nextVerifyAt: true },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyCustomDomainHandlerError({
              cause,
              message: "Failed to list custom domains for reconcile.",
              operation: "persist",
            }),
        ),
      );

    yield* Effect.forEach(
      rows.filter((row) => row.nextVerifyAt !== null),
      (row) =>
        jobs.schedule(
          emailVerifyCustomDomainJob,
          { customDomainId: row.id },
          new Date(row.nextVerifyAt as Date | string).getTime(),
        ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerifyCustomDomainHandlerError({
            cause,
            message: "Failed to schedule custom domain verify reconcile.",
            operation: "schedule",
          }),
      ),
    );
  }),
});

export const emailVerifyOwnershipHandler = defineJobHandler({
  classifyFailure: () => "retryable",
  contract: emailVerifyOwnershipJob,
  handle: (payload) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const jobs = yield* Jobs;

      const domain = yield* db.query.customDomain
        .findFirst({
          where: { id: payload.customDomainId },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyOwnershipHandlerError({
                cause,
                customDomainId: payload.customDomainId,
                message: "Failed to load custom domain for ownership verify.",
                operation: "persist",
                organizationId: payload.organizationId,
              }),
          ),
        );

      if (!domain) {
        return;
      }

      const result = yield* verifyCustomDomainOwnership({
        customDomain: domain,
        db,
        organizationId: payload.organizationId,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new VerifyOwnershipHandlerError({
              cause,
              customDomainId: payload.customDomainId,
              message: "Failed to verify custom domain ownership.",
              operation: "verify",
              organizationId: payload.organizationId,
            }),
        ),
      );

      if (result.ownershipVerificationStatus === "verified") {
        yield* jobs
          .cancel(emailVerifyOwnershipJob, {
            customDomainId: payload.customDomainId,
            organizationId: payload.organizationId,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyOwnershipHandlerError({
                  cause,
                  customDomainId: payload.customDomainId,
                  message: "Failed to cancel ownership verify job.",
                  operation: "schedule",
                  organizationId: payload.organizationId,
                }),
            ),
          );
        return;
      }

      if (result.nextCheckAt) {
        yield* jobs
          .schedule(
            emailVerifyOwnershipJob,
            {
              customDomainId: payload.customDomainId,
              organizationId: payload.organizationId,
            },
            result.nextCheckAt.getTime(),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyOwnershipHandlerError({
                  cause,
                  customDomainId: payload.customDomainId,
                  message: "Failed to schedule next ownership verify.",
                  operation: "schedule",
                  organizationId: payload.organizationId,
                }),
            ),
          );
      }
    }),
  reconcile: Effect.gen(function* () {
    const db = yield* DB;
    const jobs = yield* Jobs;
    const rows = yield* db.query.organizationDomain
      .findMany({
        columns: {
          customDomainId: true,
          organizationId: true,
          ownershipNextVerifyAt: true,
          ownershipVerificationStatus: true,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyOwnershipHandlerError({
              cause,
              message: "Failed to list ownership links for reconcile.",
              operation: "persist",
            }),
        ),
      );

    yield* Effect.forEach(
      rows.filter(
        (row) =>
          row.ownershipVerificationStatus !== "verified" && row.ownershipNextVerifyAt !== null,
      ),
      (row) =>
        jobs.schedule(
          emailVerifyOwnershipJob,
          {
            customDomainId: row.customDomainId,
            organizationId: row.organizationId,
          },
          new Date(row.ownershipNextVerifyAt as Date | string).getTime(),
        ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerifyOwnershipHandlerError({
            cause,
            message: "Failed to schedule ownership verify reconcile.",
            operation: "schedule",
          }),
      ),
    );
  }),
});
