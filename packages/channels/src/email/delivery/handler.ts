import { defineJobHandler } from "@repo/jobs";
import { type Database, type DatabaseExecutor, DB } from "@repo/persistence/db/effect";
import { customDomain, emailDelivery } from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import { deliverySkipped, messageFailed, messageSent } from "@repo/webhooks/events";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { normalizeContactEmail } from "../../messages/accept/contacts";
import {
  MessageDeliveryRetryableError,
  MessageDeliveryTerminalError,
} from "../../messages/delivery";
import { filterSuppressedContacts } from "../../messages/suppressions";
import { Usage } from "../../usage";
import { EmailBackend, type EmailBackendRejected } from "../backend";
import { mergeListUnsubscribeHeadersForSend } from "../deliverability";
import { loadEmailAttachmentsForSend } from "./attachments";
import { EmailDeliveryPersistenceError } from "./errors";
import { emailDeliverJob } from "./job";

export interface EmailDeliverHandlerOptions {
  readonly secret: string;
  readonly webOrigin: string;
}

const updateDelivery = (
  db: DatabaseExecutor,
  deliveryId: string,
  values: Partial<typeof emailDelivery.$inferInsert>,
) =>
  db
    .update(emailDelivery)
    .set(values)
    .where(eq(emailDelivery.id, deliveryId))
    .pipe(
      Effect.mapError(
        (cause) =>
          new EmailDeliveryPersistenceError({
            cause,
            deliveryId,
            operation: "update_status",
          }),
      ),
    );

const markSent = (
  db: Database,
  input: {
    readonly deliveryId: string;
    readonly messageId: string;
    readonly messageTags: Record<string, string> | null;
    readonly organizationId: string;
    readonly providerMessageId: string;
  },
) =>
  Effect.gen(function* () {
    const usage = yield* Usage;
    yield* usage.confirm({ deliveryId: input.deliveryId });
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* updateDelivery(tx, input.deliveryId, {
          completedAt: new Date(),
          providerMessageId: input.providerMessageId,
          status: "sent",
        });
        yield* emitWebhookEvent(tx, {
          event: {
            data: {
              delivery_id: input.deliveryId,
              message_id: input.messageId,
              provider_message_id: input.providerMessageId,
            },
            type: messageSent.type,
          },
          messageTags: input.messageTags,
          organizationId: input.organizationId,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new MessageDeliveryRetryableError({
                cause,
                deliveryId: input.deliveryId,
                message: "Failed to emit message.sent",
                stage: "webhooks",
              }),
          ),
        );
      }),
    );
  });

export const makeEmailDeliverHandler = (listUnsubscribe: EmailDeliverHandlerOptions) =>
  defineJobHandler({
    contract: emailDeliverJob,
    handle: (payload) =>
      Effect.gen(function* () {
        const db = yield* DB;
        const loaded = yield* db.query.emailDelivery
          .findFirst({
            where: { id: payload.deliveryId },
            with: {
              customDomain: {
                columns: { fqdn: true, id: true, isPaused: true },
                with: { registration: true },
              },
              message: true,
              sandboxDomain: {
                columns: { rootDomain: true },
                with: { registration: true },
              },
            },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new EmailDeliveryPersistenceError({
                  cause,
                  deliveryId: payload.deliveryId,
                  operation: "load_delivery",
                }),
            ),
          );

        if (!loaded?.message) {
          return yield* new MessageDeliveryTerminalError({
            deliveryId: payload.deliveryId,
            message: "Email Delivery not found",
            stage: "load",
          });
        }
        const message = loaded.message;

        if (
          loaded.status === "sent" ||
          loaded.status === "skipped" ||
          loaded.status === "canceled"
        ) {
          return;
        }

        if (loaded.customDomain?.isPaused) {
          yield* updateDelivery(db, loaded.id, {
            completedAt: new Date(),
            error: { message: "Domain is paused", retryable: false },
            status: "failed",
          });
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "Domain is paused",
            stage: "domain",
          });
        }

        const appEnvironment = yield* db.query.organizationAppEnvironment
          .findFirst({
            columns: { organizationId: true },
            where: { id: message.organizationAppEnvironmentId },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new EmailDeliveryPersistenceError({
                  cause,
                  deliveryId: loaded.id,
                  operation: "load_delivery",
                }),
            ),
          );
        if (!appEnvironment) {
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "App Environment missing for Email Delivery",
            stage: "load",
          });
        }

        const suppressionInput = {
          organizationAppEnvironmentId: message.organizationAppEnvironmentId,
          organizationId: appEnvironment.organizationId,
        };
        const to = yield* filterSuppressedContacts(db, {
          ...suppressionInput,
          recipients: loaded.to.map((email) => ({ email })),
        }).pipe(
          Effect.mapError(
            (error) =>
              new MessageDeliveryRetryableError({
                cause: error,
                deliveryId: loaded.id,
                message: "Suppression lookup failed",
                stage: "suppressions",
              }),
          ),
        );
        const cc = yield* filterSuppressedContacts(db, {
          ...suppressionInput,
          recipients: (loaded.cc ?? []).map((email) => ({ email })),
        }).pipe(
          Effect.mapError(
            (error) =>
              new MessageDeliveryRetryableError({
                cause: error,
                deliveryId: loaded.id,
                message: "Suppression lookup failed",
                stage: "suppressions",
              }),
          ),
        );
        const bcc = yield* filterSuppressedContacts(db, {
          ...suppressionInput,
          recipients: (loaded.bcc ?? []).map((email) => ({ email })),
        }).pipe(
          Effect.mapError(
            (error) =>
              new MessageDeliveryRetryableError({
                cause: error,
                deliveryId: loaded.id,
                message: "Suppression lookup failed",
                stage: "suppressions",
              }),
          ),
        );

        if (to.kept.length === 0 && cc.kept.length === 0 && bcc.kept.length === 0) {
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              yield* updateDelivery(tx, loaded.id, {
                completedAt: new Date(),
                error: {
                  details: { reason: "suppression" },
                  message: "All recipients suppressed at severity all",
                  retryable: false,
                },
                status: "skipped",
              });
              yield* emitWebhookEvent(tx, {
                event: {
                  data: {
                    delivery_id: loaded.id,
                    message_id: loaded.messageId,
                    reason: "suppression",
                  },
                  type: deliverySkipped.type,
                },
                messageTags: message.tags,
                organizationId: appEnvironment.organizationId,
              }).pipe(
                Effect.mapError(
                  (cause) =>
                    new MessageDeliveryRetryableError({
                      cause,
                      deliveryId: loaded.id,
                      message: "Failed to emit delivery.skipped",
                      stage: "webhooks",
                    }),
                ),
              );
            }),
          );
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "No deliverable recipients after suppression",
            stage: "suppressions",
          });
        }

        const identityFqdn = loaded.customDomain?.fqdn ?? loaded.sandboxDomain?.rootDomain;
        if (!identityFqdn) {
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "Email Delivery has no sender domain",
            stage: "registration",
          });
        }

        const registration =
          loaded.customDomain?.registration ?? loaded.sandboxDomain?.registration;
        if (registration?.verificationStatus !== "verified") {
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "Sending domain is not verified with SES",
            stage: "registration",
          });
        }

        const attachments = yield* loadEmailAttachmentsForSend(db, loaded.id);
        yield* updateDelivery(db, loaded.id, {
          startedAt: new Date(),
          status: "sending",
        });

        const toEmails = to.kept.map((recipient) => recipient.email);
        const ccEmails = cc.kept.map((recipient) => recipient.email);
        const bccEmails = bcc.kept.map((recipient) => recipient.email);
        const topicId = payload.topicId ?? null;

        let contactId: string | null = null;
        let orgSlug: string | null = null;
        if (
          payload.purpose === "marketing" &&
          topicId &&
          toEmails.length === 1 &&
          ccEmails.length === 0 &&
          bccEmails.length === 0
        ) {
          const organization = yield* db.query.organization
            .findFirst({
              columns: { slug: true },
              where: { id: appEnvironment.organizationId },
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new EmailDeliveryPersistenceError({
                    cause,
                    deliveryId: loaded.id,
                    operation: "load_delivery",
                  }),
              ),
            );
          orgSlug = organization?.slug ?? null;

          const recipientEmail = toEmails[0];
          if (recipientEmail) {
            const contactRow = yield* db.query.contact
              .findFirst({
                columns: { id: true },
                where: {
                  email: normalizeContactEmail(recipientEmail),
                  organizationAppEnvironmentId: message.organizationAppEnvironmentId,
                },
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new EmailDeliveryPersistenceError({
                      cause,
                      deliveryId: loaded.id,
                      operation: "load_delivery",
                    }),
                ),
              );
            contactId = contactRow?.id ?? null;
          }
        }

        const headers = mergeListUnsubscribeHeadersForSend({
          bccCount: bccEmails.length,
          ccCount: ccEmails.length,
          contactId,
          existing: loaded.headers,
          messageId: loaded.messageId,
          orgSlug,
          purpose: payload.purpose,
          secret: listUnsubscribe.secret,
          toCount: toEmails.length,
          topicId,
          webOrigin: listUnsubscribe.webOrigin,
        });

        const failProjectSendingPaused = (error: EmailBackendRejected) =>
          Effect.gen(function* () {
            const failureMessage = "SES paused sending for this Project";
            yield* db.transaction((tx) =>
              Effect.gen(function* () {
                if (loaded.customDomainId) {
                  yield* tx
                    .update(customDomain)
                    .set({ isPaused: true, pausedReason: "bad_reputation" })
                    .where(eq(customDomain.id, loaded.customDomainId))
                    .pipe(
                      Effect.mapError(
                        (cause) =>
                          new EmailDeliveryPersistenceError({
                            cause,
                            deliveryId: loaded.id,
                            operation: "update_status",
                          }),
                      ),
                    );
                }
                yield* updateDelivery(tx, loaded.id, {
                  completedAt: new Date(),
                  error: { message: failureMessage, retryable: false },
                  status: "failed",
                });
                yield* emitWebhookEvent(tx, {
                  event: {
                    data: {
                      delivery_id: loaded.id,
                      error: failureMessage,
                      message_id: loaded.messageId,
                    },
                    type: messageFailed.type,
                  },
                  messageTags: message.tags,
                  organizationId: appEnvironment.organizationId,
                }).pipe(
                  Effect.mapError(
                    (cause) =>
                      new MessageDeliveryRetryableError({
                        cause,
                        deliveryId: loaded.id,
                        message: "Failed to emit message.failed",
                        stage: "webhooks",
                      }),
                  ),
                );
              }),
            );
            return yield* new MessageDeliveryTerminalError({
              cause: error,
              deliveryId: loaded.id,
              message: failureMessage,
              stage: "send",
            });
          });

        const backend = yield* EmailBackend;
        const sent = yield* backend
          .send({
            message: {
              attachments: attachments.length > 0 ? [...attachments] : undefined,
              bcc: bccEmails.length > 0 ? bccEmails : null,
              cc: ccEmails.length > 0 ? ccEmails : null,
              from: loaded.from,
              headers: headers ?? loaded.headers,
              html: loaded.html,
              replyTo: loaded.replyTo,
              sender: { identityFqdn, projectId: appEnvironment.organizationId },
              subject: loaded.subject,
              text: loaded.text,
              to: toEmails,
            },
            region: registration.region,
          })
          .pipe(
            Effect.catch((error) =>
              // A Project Sending Pause is SES isolating this Project: retrying cannot get
              // past it, and other Projects keep sending.
              error._tag === "EmailBackendRejected" && error.reason === "project_sending_paused"
                ? failProjectSendingPaused(error)
                : Effect.fail(
                    new MessageDeliveryRetryableError({
                      cause: error,
                      deliveryId: loaded.id,
                      message: "SES send failed",
                      stage: "send",
                    }),
                  ),
            ),
          );

        yield* markSent(db, {
          deliveryId: loaded.id,
          messageId: loaded.messageId,
          messageTags: message.tags,
          organizationId: appEnvironment.organizationId,
          providerMessageId: sent.providerMessageId,
        });
      }).pipe(
        Effect.mapError((error) => {
          switch (error._tag) {
            case "MessageDeliveryRetryableError":
            case "EmailDeliveryPersistenceError":
            case "MessageDeliveryTerminalError":
              return error;
            default:
              return new MessageDeliveryRetryableError({
                cause: error,
                deliveryId: payload.deliveryId,
                message: "Unexpected delivery failure",
                stage: "runtime",
              });
          }
        }),
      ),
    classifyFailure: (failure) => {
      switch (failure._tag) {
        case "MessageDeliveryRetryableError":
        case "EmailDeliveryPersistenceError":
          return "retryable";
        default:
          return "terminal";
      }
    },
    // A Delivery that out-ran its retries, or stopped on an error that left it unfinished,
    // ends failed here, so it is never left queued or sending and the Project hears of it.
    onDeadLetter: ({ deliveryId }, _execution, failure) =>
      Effect.gen(function* () {
        const db = yield* DB;
        const failureMessage =
          failure._tag === "EmailDeliveryPersistenceError"
            ? "The Delivery could not be recorded"
            : failure.message;
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const [failed] = yield* tx
              .update(emailDelivery)
              .set({
                completedAt: new Date(),
                error: { message: failureMessage, retryable: false },
                status: "failed",
              })
              .where(
                and(
                  eq(emailDelivery.id, deliveryId),
                  inArray(emailDelivery.status, ["queued", "sending"]),
                ),
              )
              .returning({ messageId: emailDelivery.messageId });
            if (!failed) {
              return;
            }
            const message = yield* tx.query.message.findFirst({
              columns: { tags: true },
              where: { id: failed.messageId },
              with: { appEnvironment: { columns: { organizationId: true } } },
            });
            if (!message?.appEnvironment) {
              return;
            }
            yield* emitWebhookEvent(tx, {
              event: {
                data: {
                  delivery_id: deliveryId,
                  error: failureMessage,
                  message_id: failed.messageId,
                },
                type: messageFailed.type,
              },
              messageTags: message.tags,
              organizationId: message.appEnvironment.organizationId,
            });
          }),
        );
        const usage = yield* Usage;
        yield* usage.release({ deliveryId });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Failed to record a dead-lettered Delivery", cause).pipe(
            Effect.annotateLogs({ deliveryId }),
          ),
        ),
      ),
  });
