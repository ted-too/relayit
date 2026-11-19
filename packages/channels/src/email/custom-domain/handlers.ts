import { defineJobHandler, Jobs } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  removedDomainIdentity,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { Clock, Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import { emailDeleteDomainIdentityJob } from "./jobs";
import { IDENTITY_CALL_TIMEOUT, LATE_IDENTITY_GRACE_MS, lockDomainIdentity } from "./lifecycle";

export class DeleteDomainIdentityHandlerError extends Data.TaggedError(
  "DeleteDomainIdentityHandlerError",
)<{
  readonly cause?: unknown;
  readonly fqdn?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "delete_identity" | "persist";
}> {}

export const emailDeleteDomainIdentityHandler = defineJobHandler({
  contract: emailDeleteDomainIdentityJob,
  handle: (payload) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const backend = yield* EmailBackend;
      const jobs = yield* Jobs;
      const region = payload.region ?? backend.defaultRegion;

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* lockDomainIdentity(tx, payload.fqdn);
            const registered = yield* tx
              .select({ region: emailDomainRegistration.region })
              .from(emailDomainRegistration)
              .innerJoin(customDomain, eq(customDomain.id, emailDomainRegistration.customDomainId))
              .where(eq(customDomain.fqdn, payload.fqdn));
            // The FQDN was added again and registered before this ran: SES names the
            // identity by FQDN, so it is now that Domain's and stays.
            if (registered.some((now) => (now.region ?? backend.defaultRegion) === region)) {
              return;
            }
            // A Sandbox Domain's identity is every Project's, and no custom Domain's removal
            // may take it: `createCustomDomain` refuses such an FQDN, and this holds for a job
            // queued before it did.
            const [sandbox] = yield* tx
              .select({ id: sandboxDomain.id })
              .from(sandboxDomain)
              .where(sql`lower(${sandboxDomain.rootDomain}) = lower(${payload.fqdn})`)
              .limit(1);
            if (sandbox) {
              return;
            }
            // A call that never answers would hold this connection and the FQDN's identity
            // lock, and with it every registration of the FQDN. The retry deletes it.
            const deleted = yield* backend.deleteIdentity(payload).pipe(
              Effect.timeoutOrElse({
                duration: IDENTITY_CALL_TIMEOUT,
                orElse: () =>
                  Effect.fail(
                    new DeleteDomainIdentityHandlerError({
                      fqdn: payload.fqdn,
                      message: "SES did not answer in time while deleting the identity.",
                      operation: "delete_identity",
                    }),
                  ),
              }),
            );
            // The identity's record goes with the identity. When SES had none of the
            // Domain's, a create given up on may still land for a while after the removal,
            // and the record is what lets an add of the FQDN delete it meanwhile. So the
            // record goes once that time has passed, and until then this job is queued to
            // look once more when it has: that run deletes an identity that landed late, and
            // the record either way. A record kept for good would have every registration
            // of the FQDN ask SES about it, inside its own timeout.
            const [cleared] = yield* tx
              .delete(removedDomainIdentity)
              .where(
                and(
                  eq(removedDomainIdentity.fqdn, payload.fqdn),
                  eq(removedDomainIdentity.dkimSelector, payload.dkimSelector),
                  deleted
                    ? undefined
                    : sql`${removedDomainIdentity.createdAt} <= now() - make_interval(secs => ${LATE_IDENTITY_GRACE_MS / 1000})`,
                ),
              )
              .returning({ id: removedDomainIdentity.id });
            if (deleted || cleared) {
              return;
            }
            // Only while a record is left: one a registration has cleared was acted on there.
            const [recorded] = yield* tx
              .select({ id: removedDomainIdentity.id })
              .from(removedDomainIdentity)
              .where(
                and(
                  eq(removedDomainIdentity.fqdn, payload.fqdn),
                  eq(removedDomainIdentity.dkimSelector, payload.dkimSelector),
                ),
              )
              .limit(1);
            if (recorded) {
              yield* jobs.enqueue(emailDeleteDomainIdentityJob, payload, tx, {
                delayUntil: (yield* Clock.currentTimeMillis) + LATE_IDENTITY_GRACE_MS,
              });
            }
          }),
        )
        .pipe(
          Effect.mapError((error) => {
            switch (error._tag) {
              case "DeleteDomainIdentityHandlerError":
              case "EmailBackendAuthenticationError":
              case "EmailBackendConfigurationError":
              case "EmailBackendIdentityConflict":
              case "EmailBackendMessageError":
              case "EmailBackendRateLimited":
              case "EmailBackendRejected":
              case "EmailBackendUnavailable":
              case "JobEnqueueError":
                return error;
              default:
                return new DeleteDomainIdentityHandlerError({
                  cause: error,
                  fqdn: payload.fqdn,
                  message: "Failed to check whether the Domain was added again.",
                  operation: "persist",
                });
            }
          }),
        );
    }),
  // An outage, a throttle, a call that timed out or a database failure may pass, and so
  // may refused credentials, as while a key is rotated. Retrying matters here: the Domain's
  // row is gone, so nothing deletes the identity of a dead letter. A region this deployment
  // no longer has, or a request SES rejects as invalid, will not pass.
  classifyFailure: (failure) => {
    switch (failure._tag) {
      case "DeleteDomainIdentityHandlerError":
      case "EmailBackendAuthenticationError":
      case "EmailBackendRateLimited":
      case "EmailBackendUnavailable":
      case "JobEnqueueError":
        return "retryable";
      default:
        return "terminal";
    }
  },
});
