import { ingestDeliveryEvents } from "@repo/channels/email/deliverability";
import { logEffectFailure } from "@repo/logging";
import { DB } from "@repo/persistence/db/effect";
import { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { ByteSize, Effect } from "effect";
import { HttpIncomingMessage } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Api, SesNotificationFailed, SesNotificationRejected } from "../../api";

/**
 * The largest body this route reads. Anyone can post here, and the body is read before
 * SNS's signature can be checked. The worker makes its topics without a
 * `MaximumMessageSize`, so they keep SNS's default of 256 KiB of message, which arrives as
 * one JSON string inside its envelope: escaping can double or at most triple it, and the
 * envelope's own fields (signature, certificate and unsubscribe URLs) add a few KB, so
 * nothing they send reaches 1 MiB. Raise this with that attribute, or real notifications
 * get a 400 SNS does not retry.
 */
const MAX_SES_NOTIFICATION_BYTES = 1024 * 1024;

/**
 * SES's bounce, complaint and delivery notifications, as SNS posts them: `text/plain`
 * holding JSON, so the raw body is read whatever the content type. A notification that
 * fails SNS's checks, or comes from a topic this deployment did not subscribe, is a 400,
 * which SNS does not retry; one we could not check, confirm or record is a 500, which it
 * retries. A body over `MAX_SES_NOTIFICATION_BYTES` is not SNS's and is a 400 too: by its
 * `Content-Length` before any of it is read, or, without one, once reading it passes the
 * limit. `handle` is the real one unless a test swaps it.
 */
export const sesNotificationHandlers = (handle = handleSesNotification) =>
  HttpApiBuilder.group(Api, "sesNotifications", (handlers) =>
    Effect.succeed(
      handlers.handleRaw("receive", ({ request }) =>
        Effect.gen(function* () {
          const outcome = yield* Effect.gen(function* () {
            const body = yield* request.text.pipe(
              Effect.provideService(
                HttpIncomingMessage.MaxBodySize,
                ByteSize.fromInputUnsafe(MAX_SES_NOTIFICATION_BYTES),
              ),
              Effect.catchIf(
                ({ reason }) =>
                  reason._tag === "RequestParseError" && reason.reason === "BodyTooLarge",
                () => Effect.succeed(undefined),
              ),
            );
            if (body === undefined) {
              yield* Effect.logWarning("Rejected an SES notification over the size limit");
              return "rejected" as const;
            }
            const notification = yield* handle(body).pipe(Effect.result);
            if (notification._tag === "Failure") {
              switch (notification.failure._tag) {
                // Not the sender's fault: SNS retries it once the account can be looked up.
                case "AwsSnsTopicsUnavailable":
                  return yield* notification.failure;
                // SNS couldn't be reached to confirm; it sends the confirmation again.
                case "AwsSubscriptionConfirmationError":
                  if (notification.failure.reason === "request_failed") {
                    return yield* notification.failure;
                  }
                  yield* Effect.logWarning("Rejected an SES notification", notification.failure);
                  return "rejected" as const;
                default:
                  yield* Effect.logWarning("Rejected an SES notification", notification.failure);
                  return "rejected" as const;
              }
            }
            if (notification.success.type === "events") {
              const db = yield* DB;
              yield* ingestDeliveryEvents(db, { events: notification.success.events });
            }
            return "recorded" as const;
          }).pipe(
            Effect.catchCause((cause) =>
              logEffectFailure("SES notification handling failed")(cause).pipe(
                Effect.andThen(
                  Effect.fail(
                    new SesNotificationFailed({
                      code: "internal_server_error",
                      message: "SES notification handling failed",
                    }),
                  ),
                ),
              ),
            ),
          );
          if (outcome === "rejected") {
            return yield* new SesNotificationRejected({
              code: "bad_request",
              message: "SES notification handling failed",
            });
          }
          return { ok: true as const };
        }),
      ),
    ),
  );
