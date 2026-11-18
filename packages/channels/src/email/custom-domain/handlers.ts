import { defineJobHandler } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import { customDomain, emailDomainRegistration } from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import { emailDeleteDomainIdentityJob } from "./jobs";
import { IDENTITY_CALL_TIMEOUT, lockDomainIdentity } from "./lifecycle";

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
            // A call that never answers would hold this connection and the FQDN's identity
            // lock, and with it every registration of the FQDN. The retry deletes it.
            yield* backend.deleteIdentity({ fqdn: payload.fqdn, region: payload.region }).pipe(
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
          }),
        )
        .pipe(
          Effect.mapError((error) => {
            switch (error._tag) {
              case "DeleteDomainIdentityHandlerError":
              case "EmailBackendAuthenticationError":
              case "EmailBackendConfigurationError":
              case "EmailBackendMessageError":
              case "EmailBackendRateLimited":
              case "EmailBackendRejected":
              case "EmailBackendUnavailable":
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
  // An outage, a throttle, a call that timed out or a database failure may pass. A region
  // this deployment no longer has, refused credentials or a refusal from SES will not.
  classifyFailure: (failure) => {
    switch (failure._tag) {
      case "DeleteDomainIdentityHandlerError":
      case "EmailBackendRateLimited":
      case "EmailBackendUnavailable":
        return "retryable";
      default:
        return "terminal";
    }
  },
});
