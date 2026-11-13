import { ingestDeliveryEvents } from "@repo/channels/email/deliverability";
import { logEffectFailure } from "@repo/logging";
import { DB } from "@repo/persistence/db/effect";
import { handleSesNotification, SES_NOTIFICATIONS_PATH } from "@repo/provider-aws/email/webhooks";
import { Effect } from "effect";
import { Elysia, status } from "elysia";
import type { RunApiEffect } from "../../lib/effect";

/**
 * SES's bounce, complaint and delivery notifications, as SNS posts them. A notification
 * that fails SNS's checks is a 400, which SNS does not retry; one we could not record is a
 * 500, which it retries.
 */
export const createSesNotificationRoutes = (
  runEffect: RunApiEffect,
  handle = handleSesNotification,
) =>
  new Elysia().post(
    SES_NOTIFICATIONS_PATH,
    async ({ request }) => {
      const rawBody = await request.text();
      return runEffect(
        Effect.gen(function* () {
          const notification = yield* handle(rawBody).pipe(Effect.result);
          if (notification._tag === "Failure") {
            yield* Effect.logWarning("Rejected an SES notification", notification.failure);
            return status(400, {
              code: "bad_request",
              message: "SES notification handling failed",
            });
          }
          if (notification.success.type === "events") {
            const db = yield* DB;
            yield* ingestDeliveryEvents(db, { events: notification.success.events });
          }
          return status(200, { ok: true as const });
        }).pipe(
          Effect.catchCause((cause) =>
            logEffectFailure("SES notification handling failed")(cause).pipe(
              Effect.as(
                status(500, {
                  code: "internal_server_error",
                  message: "SES notification handling failed",
                }),
              ),
            ),
          ),
        ),
        { signal: request.signal },
      );
    },
    { detail: { hide: true } },
  );
