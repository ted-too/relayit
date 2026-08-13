import { defineJobHandler, Jobs } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import { Data, Effect } from "effect";
import { sweepIfSandboxAllocatable } from "../sandbox/allocate";
import {
  verifyCustomDomainOwnership,
  verifyCustomDomainProviderIdentity,
} from "./custom-identity";
import {
  emailVerifyCustomDomainJob,
  emailVerifyOwnershipJob,
  emailVerifyProviderIdentityJob,
  emailVerifySandboxDomainJob,
} from "./jobs";
import { verifySandboxProviderIdentity } from "./sandbox-identity";

export class VerifyProviderIdentityHandlerError extends Data.TaggedError(
  "VerifyProviderIdentityHandlerError"
)<{
  readonly cause?: unknown;
  readonly identityId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "persist" | "schedule" | "verify";
}> {}

export class VerifySandboxDomainHandlerError extends Data.TaggedError(
  "VerifySandboxDomainHandlerError"
)<{
  readonly cause?: unknown;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "persist" | "schedule" | "sweep" | "verify";
  readonly sandboxDomainId?: string;
}> {}

export class VerifyCustomDomainHandlerError extends Data.TaggedError(
  "VerifyCustomDomainHandlerError"
)<{
  readonly cause?: unknown;
  readonly customDomainId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "persist" | "schedule" | "verify";
}> {}

export class VerifyOwnershipHandlerError extends Data.TaggedError(
  "VerifyOwnershipHandlerError"
)<{
  readonly cause?: unknown;
  readonly customDomainId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "persist" | "schedule" | "verify";
  readonly organizationId?: string;
}> {}

export const emailVerifyProviderIdentityHandler = defineJobHandler({
  classifyFailure: () => "retryable",
  contract: emailVerifyProviderIdentityJob,
  handle: (payload) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const jobs = yield* Jobs;

      const identity = yield* db.query.emailDomainProviderIdentity
        .findFirst({
          where: { id: payload.identityId },
          with: {
            customDomain: true,
            provider: true,
            sandboxDomain: true,
          },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyProviderIdentityHandlerError({
                cause,
                identityId: payload.identityId,
                message: "Failed to load provider identity for verify.",
                operation: "persist",
              })
          )
        );

      if (!identity?.provider) {
        return;
      }

      if (identity.sandboxDomain) {
        yield* verifySandboxProviderIdentity({
          db,
          fqdn: identity.sandboxDomain.rootDomain,
          identity,
          provider: identity.provider,
          sandboxDomainId: identity.sandboxDomain.id,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new VerifyProviderIdentityHandlerError({
                cause,
                identityId: payload.identityId,
                message: "Failed to verify sandbox provider identity.",
                operation: "verify",
              })
          )
        );
      } else if (identity.customDomain) {
        yield* verifyCustomDomainProviderIdentity({
          customDomainId: identity.customDomain.id,
          db,
          fqdn: identity.customDomain.fqdn,
          identity,
          provider: identity.provider,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new VerifyProviderIdentityHandlerError({
                cause,
                identityId: payload.identityId,
                message: "Failed to verify custom domain provider identity.",
                operation: "verify",
              })
          )
        );
      } else {
        return;
      }

      const refreshed = yield* db.query.emailDomainProviderIdentity
        .findFirst({
          columns: { nextVerifyAt: true },
          where: { id: payload.identityId },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyProviderIdentityHandlerError({
                cause,
                identityId: payload.identityId,
                message: "Failed to reload identity after verify.",
                operation: "persist",
              })
          )
        );

      if (refreshed?.nextVerifyAt) {
        yield* jobs
          .schedule(
            emailVerifyProviderIdentityJob,
            { identityId: payload.identityId },
            new Date(refreshed.nextVerifyAt).getTime()
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyProviderIdentityHandlerError({
                  cause,
                  identityId: payload.identityId,
                  message: "Failed to schedule next identity verify.",
                  operation: "schedule",
                })
            )
          );
      } else {
        yield* jobs
          .cancel(emailVerifyProviderIdentityJob, {
            identityId: payload.identityId,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyProviderIdentityHandlerError({
                  cause,
                  identityId: payload.identityId,
                  message: "Failed to cancel identity verify job.",
                  operation: "schedule",
                })
            )
          );
      }
    }),
  reconcile: Effect.gen(function* () {
    const db = yield* DB;
    const jobs = yield* Jobs;
    const rows = yield* db.query.emailDomainProviderIdentity
      .findMany({
        columns: { id: true, nextVerifyAt: true },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new VerifyProviderIdentityHandlerError({
              cause,
              message: "Failed to list identities for reconcile.",
              operation: "persist",
            })
        )
      );

    yield* Effect.forEach(
      rows.filter((row) => row.nextVerifyAt !== null),
      (row) =>
        jobs.schedule(
          emailVerifyProviderIdentityJob,
          { identityId: row.id },
          new Date(row.nextVerifyAt as Date | string).getTime()
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerifyProviderIdentityHandlerError({
            cause,
            message: "Failed to schedule identity verify reconcile.",
            operation: "schedule",
          })
      )
    );
  }),
});

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
          with: {
            providerIdentities: {
              with: { provider: true },
            },
          },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifySandboxDomainHandlerError({
                cause,
                message: "Failed to load sandbox domain for verify.",
                operation: "persist",
                sandboxDomainId: payload.sandboxDomainId,
              })
          )
        );

      if (!sandbox) {
        return;
      }

      let earliestIdentityCheckAt: Date | null = null;

      for (const identity of sandbox.providerIdentities) {
        if (!identity.provider) {
          continue;
        }

        const result = yield* verifySandboxProviderIdentity({
          db,
          fqdn: sandbox.rootDomain,
          identity,
          provider: identity.provider,
          sandboxDomainId: sandbox.id,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new VerifySandboxDomainHandlerError({
                cause,
                message: "Failed to verify sandbox provider identity.",
                operation: "verify",
                sandboxDomainId: sandbox.id,
              })
          )
        );

        if (
          !earliestIdentityCheckAt ||
          result.identityNextCheckAt < earliestIdentityCheckAt
        ) {
          earliestIdentityCheckAt = result.identityNextCheckAt;
        }

        // Schedule the identity's own cadence — do not enqueue an immediate
        // re-verify after this sandbox pass already checked it.
        yield* jobs
          .schedule(
            emailVerifyProviderIdentityJob,
            { identityId: identity.id },
            result.identityNextCheckAt.getTime()
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifySandboxDomainHandlerError({
                  cause,
                  message: "Failed to schedule identity verify after sandbox.",
                  operation: "schedule",
                  sandboxDomainId: sandbox.id,
                })
            )
          );
      }

      yield* sweepIfSandboxAllocatable(sandbox.id).pipe(
        Effect.mapError(
          (cause) =>
            new VerifySandboxDomainHandlerError({
              cause,
              message: "Failed to sweep sandbox allocation after verify.",
              operation: "sweep",
              sandboxDomainId: sandbox.id,
            })
        )
      );

      if (earliestIdentityCheckAt) {
        yield* jobs
          .schedule(
            emailVerifySandboxDomainJob,
            { sandboxDomainId: sandbox.id },
            earliestIdentityCheckAt.getTime()
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifySandboxDomainHandlerError({
                  cause,
                  message: "Failed to schedule next sandbox verify.",
                  operation: "schedule",
                  sandboxDomainId: sandbox.id,
                })
            )
          );
      } else {
        yield* jobs
          .cancel(emailVerifySandboxDomainJob, {
            sandboxDomainId: sandbox.id,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifySandboxDomainHandlerError({
                  cause,
                  message: "Failed to cancel sandbox verify job.",
                  operation: "schedule",
                  sandboxDomainId: sandbox.id,
                })
            )
          );
      }
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
            })
        )
      );

    yield* Effect.forEach(
      rows.filter((row) => row.nextVerifyAt !== null),
      (row) =>
        jobs.schedule(
          emailVerifySandboxDomainJob,
          { sandboxDomainId: row.id },
          new Date(row.nextVerifyAt as Date | string).getTime()
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerifySandboxDomainHandlerError({
            cause,
            message: "Failed to schedule sandbox verify reconcile.",
            operation: "schedule",
          })
      )
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
          with: {
            providerIdentities: {
              with: { provider: true },
            },
          },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new VerifyCustomDomainHandlerError({
                cause,
                customDomainId: payload.customDomainId,
                message: "Failed to load custom domain for verify.",
                operation: "persist",
              })
          )
        );

      if (!domain) {
        return;
      }

      let earliestIdentityCheckAt: Date | null = null;

      for (const identity of domain.providerIdentities) {
        if (!identity.provider) {
          continue;
        }

        const result = yield* verifyCustomDomainProviderIdentity({
          customDomainId: domain.id,
          db,
          fqdn: domain.fqdn,
          identity,
          provider: identity.provider,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new VerifyCustomDomainHandlerError({
                cause,
                customDomainId: domain.id,
                message: "Failed to verify custom domain provider identity.",
                operation: "verify",
              })
          )
        );

        if (
          !earliestIdentityCheckAt ||
          result.identityNextCheckAt < earliestIdentityCheckAt
        ) {
          earliestIdentityCheckAt = result.identityNextCheckAt;
        }

        yield* jobs
          .schedule(
            emailVerifyProviderIdentityJob,
            { identityId: identity.id },
            result.identityNextCheckAt.getTime()
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyCustomDomainHandlerError({
                  cause,
                  customDomainId: domain.id,
                  message: "Failed to schedule identity verify after domain.",
                  operation: "schedule",
                })
            )
          );
      }

      if (earliestIdentityCheckAt) {
        yield* jobs
          .schedule(
            emailVerifyCustomDomainJob,
            { customDomainId: domain.id },
            earliestIdentityCheckAt.getTime()
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyCustomDomainHandlerError({
                  cause,
                  customDomainId: domain.id,
                  message: "Failed to schedule next custom domain verify.",
                  operation: "schedule",
                })
            )
          );
      } else {
        yield* jobs
          .cancel(emailVerifyCustomDomainJob, {
            customDomainId: domain.id,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new VerifyCustomDomainHandlerError({
                  cause,
                  customDomainId: domain.id,
                  message: "Failed to cancel custom domain verify job.",
                  operation: "schedule",
                })
            )
          );
      }
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
            })
        )
      );

    yield* Effect.forEach(
      rows.filter((row) => row.nextVerifyAt !== null),
      (row) =>
        jobs.schedule(
          emailVerifyCustomDomainJob,
          { customDomainId: row.id },
          new Date(row.nextVerifyAt as Date | string).getTime()
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerifyCustomDomainHandlerError({
            cause,
            message: "Failed to schedule custom domain verify reconcile.",
            operation: "schedule",
          })
      )
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
              })
          )
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
            })
        )
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
                })
            )
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
            result.nextCheckAt.getTime()
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
                })
            )
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
            })
        )
      );

    yield* Effect.forEach(
      rows.filter(
        (row) =>
          row.ownershipVerificationStatus !== "verified" &&
          row.ownershipNextVerifyAt !== null
      ),
      (row) =>
        jobs.schedule(
          emailVerifyOwnershipJob,
          {
            customDomainId: row.customDomainId,
            organizationId: row.organizationId,
          },
          new Date(row.ownershipNextVerifyAt as Date | string).getTime()
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.mapError(
        (cause) =>
          new VerifyOwnershipHandlerError({
            cause,
            message: "Failed to schedule ownership verify reconcile.",
            operation: "schedule",
          })
      )
    );
  }),
});
