import { ingestDeliveryEvents } from "@repo/channels/email/deliverability";
import { logEffectFailure } from "@repo/logging";
import { DB } from "@repo/persistence/db/effect";
import { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api, SesNotificationFailed, SesNotificationRejected } from "../../api";

/**
 * SES's bounce, complaint and delivery notifications, as SNS posts them: `text/plain`
 * holding JSON, so the raw body is read whatever the content type. A notification that
 * fails SNS's checks is a 400, which SNS does not retry; one we could not record is a 500,
 * which it retries. `handle` is the real one unless a test swaps it.
 */
export const sesNotificationHandlers = (handle = handleSesNotification) =>
  HttpApiBuilder.group(Api, "sesNotifications", (handlers) =>
    Effect.succeed(
      handlers.handleRaw("receive", ({ request }) =>
        Effect.gen(function* () {
          const outcome = yield* Effect.gen(function* () {
            const notification = yield* handle(yield* request.text).pipe(Effect.result);
            if (notification._tag === "Failure") {
              yield* Effect.logWarning("Rejected an SES notification", notification.failure);
              return "rejected" as const;
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
