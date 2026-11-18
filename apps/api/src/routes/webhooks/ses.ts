import {
  ingestDeliveryEvents,
  syncProjectSendingStatus,
} from "@repo/channels/email/deliverability";
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
 * which SNS does not retry; one we could not check, confirm or record, or whose Delivery
 * the worker has not recorded yet, is a 500, which it retries. A body over
 * `MAX_SES_NOTIFICATION_BYTES` is not SNS's and is a 400 too: by its `Content-Length`
 * before any of it is read, or, without one, once reading it passes the limit.
 *
 * The same topics carry EventBridge's reports that SES changed a tenant's sending status,
 * under the same checks. One for a Project of this deployment makes the api ask SES for the
 * status now and pause or unpause the Project's Domains to match; if SES or Postgres cannot
 * be asked it is a 500, so SNS brings it back. One for anything else is acknowledged.
 * `handle` is the real one unless a test swaps it.
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
              const early = yield* ingestDeliveryEvents(db, {
                events: notification.success.events,
              }).pipe(
                Effect.as(undefined),
                Effect.catchTags({ DeliveryNotRecordedYet: (error) => Effect.succeed(error) }),
              );
              if (early) {
                // Expected, not a fault: SES can report on a send before the worker has
                // recorded it. Answered as a failure so that SNS sends it again.
                yield* Effect.logInfo(
                  "SES notification arrived before its Delivery was recorded; SNS will send it again",
                  { providerMessageId: early.providerMessageId },
                );
                return "not_recorded_yet" as const;
              }
            }
            if (notification.success.type === "project_sending_status_changed") {
              const db = yield* DB;
              const { projectId, region } = notification.success;
              const synced = yield* syncProjectSendingStatus(db, { projectId, region });
              yield* Effect.logInfo("SES reported a tenant's sending status changed", {
                ...synced,
                projectId,
                region,
              });
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
          if (outcome === "not_recorded_yet") {
            return yield* new SesNotificationFailed({
              code: "internal_server_error",
              message: "SES notification handling failed",
            });
          }
          return { ok: true as const };
        }),
      ),
    ),
  );
