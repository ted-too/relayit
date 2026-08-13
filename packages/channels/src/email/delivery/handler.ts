import { defineJobHandler } from "@repo/jobs";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import {
  type Database,
  type DatabaseExecutor,
  DB,
} from "@repo/persistence/db/effect";
import { emailDelivery } from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import {
  deliverySkipped,
  messageFailed,
  messageSent,
} from "@repo/webhooks/events";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { normalizeContactEmail } from "../../messages/accept/contacts";
import {
  MessageDeliveryRetryableError,
  MessageDeliveryTerminalError,
  providerCircuitAllow,
  providerCircuitRecordFailure,
  providerCircuitRecordSuccess,
} from "../../messages/delivery";
import { filterSuppressedContacts } from "../../messages/suppressions";
import { makeProviderTypeId } from "../../provider-type";
import { Usage, UsageLimitExceeded } from "../../usage";
import { mergeListUnsubscribeHeadersForSend } from "../deliverability";
import type { ProviderEmailAttachment } from "../provider-message";
import { EmailProviderRegistry } from "../provider-registry";
import { loadEmailAttachmentsForSend } from "./attachments";
import {
  EmailDeliveryPersistenceError,
  EmailDeliveryProviderError,
} from "./errors";
import {
  listFailoverProviderIdentities,
  providerKindFor,
  type RoutableEmailProviderIdentity,
} from "./identities";
import { emailDeliverJob } from "./job";

export interface EmailDeliverHandlerOptions {
  readonly secret: string;
  readonly webOrigin: string;
}

interface SendableDelivery {
  readonly from: (typeof emailDelivery.$inferSelect)["from"];
  readonly headers: (typeof emailDelivery.$inferSelect)["headers"];
  readonly html: string | null;
  readonly id: string;
  readonly replyTo: (typeof emailDelivery.$inferSelect)["replyTo"];
  readonly subject: string;
  readonly text: string | null;
}

const updateDelivery = (
  db: DatabaseExecutor,
  deliveryId: string,
  values: Partial<typeof emailDelivery.$inferInsert>
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
          })
      )
    );

const markSent = (
  db: Database,
  input: {
    readonly deliveryId: string;
    readonly messageId: string;
    readonly messageTags: Record<string, string> | null;
    readonly organizationId: string;
    readonly providerId: string;
    readonly providerMessageId: string;
  }
) =>
  Effect.gen(function* () {
    const usage = yield* Usage;
    yield* usage.confirm({ deliveryId: input.deliveryId });
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* updateDelivery(tx, input.deliveryId, {
          completedAt: new Date(),
          providerId: input.providerId,
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
              })
          )
        );
      })
    );
  });

const trySendWithIdentity = (
  identity: RoutableEmailProviderIdentity,
  input: {
    readonly attachments: readonly ProviderEmailAttachment[];
    readonly bcc: readonly string[];
    readonly cc: readonly string[];
    readonly delivery: SendableDelivery;
    readonly to: readonly string[];
  }
) =>
  Effect.gen(function* () {
    const usage = yield* Usage;
    const targetKind = providerKindFor(identity.provider);
    const remeterError = yield* usage
      .remeter({ deliveryId: input.delivery.id, providerKind: targetKind })
      .pipe(
        Effect.as(null as UsageLimitExceeded | null),
        Effect.catchIf(
          (error): error is UsageLimitExceeded =>
            error instanceof UsageLimitExceeded,
          (error) => Effect.succeed(error)
        )
      );
    if (remeterError) {
      return {
        error: new EmailDeliveryProviderError({
          cause: remeterError,
          deliveryId: input.delivery.id,
          leaveActive: true,
          message: "Usage bucket exhausted",
          providerId: identity.provider.id,
          providerKind: targetKind,
        }),
        leaveActive: true,
        ok: false as const,
      };
    }

    const sendError = yield* Effect.gen(function* () {
      const vault = yield* ProviderCredentialsVault;
      const registry = yield* EmailProviderRegistry;
      const factory = yield* registry.get(
        makeProviderTypeId(
          identity.provider.vendorId,
          identity.provider.productId
        )
      );
      const credentials = yield* vault.open(identity.provider.credentials);
      const adapter = yield* factory.create({
        credentials,
        providerId: identity.provider.id,
      });
      return yield* adapter.send({
        attachments:
          input.attachments.length > 0 ? [...input.attachments] : undefined,
        bcc: input.bcc.length > 0 ? [...input.bcc] : null,
        cc: input.cc.length > 0 ? [...input.cc] : null,
        from: input.delivery.from,
        headers: input.delivery.headers,
        html: input.delivery.html,
        replyTo: input.delivery.replyTo,
        subject: input.delivery.subject,
        text: input.delivery.text,
        to: [...input.to],
      });
    }).pipe(
      Effect.map((result) => ({ ok: true as const, result })),
      Effect.catch((cause) =>
        Effect.succeed({
          cause,
          ok: false as const,
        })
      )
    );

    if (!sendError.ok) {
      yield* providerCircuitRecordFailure(identity.provider.id);
      const allowed = yield* providerCircuitAllow(identity.provider.id);
      return {
        error: new EmailDeliveryProviderError({
          cause: sendError.cause,
          deliveryId: input.delivery.id,
          leaveActive: !allowed,
          message: "Provider send failed",
          providerId: identity.provider.id,
        }),
        leaveActive: !allowed,
        ok: false as const,
      };
    }

    yield* providerCircuitRecordSuccess(identity.provider.id);
    return {
      ok: true as const,
      providerId: identity.provider.id,
      providerMessageId: sendError.result.providerMessageId,
    };
  });

export const makeEmailDeliverHandler = (
  listUnsubscribe: EmailDeliverHandlerOptions
) =>
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
                columns: { id: true, isPaused: true },
              },
              message: true,
            },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new EmailDeliveryPersistenceError({
                  cause,
                  deliveryId: payload.deliveryId,
                  operation: "load_delivery",
                })
            )
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
                })
            )
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
              })
          )
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
              })
          )
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
              })
          )
        );

        if (
          to.kept.length === 0 &&
          cc.kept.length === 0 &&
          bcc.kept.length === 0
        ) {
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
                    })
                )
              );
            })
          );
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "No deliverable recipients after suppression",
            stage: "suppressions",
          });
        }

        if (!(loaded.customDomainId || loaded.sandboxDomainId)) {
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "Email Delivery has no sender domain",
            stage: "identities",
          });
        }

        const identities = yield* listFailoverProviderIdentities(
          db,
          loaded.customDomainId
            ? { customDomainId: loaded.customDomainId, kind: "custom-domain" }
            : {
                kind: "sandbox-domain",
                sandboxDomainId: loaded.sandboxDomainId as string,
              },
          loaded.id
        );
        if (identities.length === 0) {
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "No routable provider identity",
            stage: "identities",
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
                  })
              )
            );
          orgSlug = organization?.slug ?? null;

          const recipientEmail = toEmails[0];
          if (recipientEmail) {
            const contactRow = yield* db.query.contact
              .findFirst({
                columns: { id: true },
                where: {
                  email: normalizeContactEmail(recipientEmail),
                  organizationAppEnvironmentId:
                    message.organizationAppEnvironmentId,
                },
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new EmailDeliveryPersistenceError({
                      cause,
                      deliveryId: loaded.id,
                      operation: "load_delivery",
                    })
                )
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

        const [primary, ...standby] = identities;
        const sendInput = {
          attachments,
          bcc: bccEmails,
          cc: ccEmails,
          delivery: {
            ...loaded,
            headers: headers ?? loaded.headers,
          },
          to: toEmails,
        };

        if (primary && (yield* providerCircuitAllow(primary.provider.id))) {
          const primaryResult = yield* trySendWithIdentity(primary, sendInput);
          if (primaryResult.ok) {
            yield* markSent(db, {
              deliveryId: loaded.id,
              messageId: loaded.messageId,
              messageTags: message.tags,
              organizationId: appEnvironment.organizationId,
              providerId: primaryResult.providerId,
              providerMessageId: primaryResult.providerMessageId,
            });
            return;
          }
          if (!primaryResult.leaveActive) {
            return yield* new MessageDeliveryRetryableError({
              cause: primaryResult.error,
              deliveryId: loaded.id,
              message: primaryResult.error.message,
              stage: "send",
            });
          }
        }

        let lastError: EmailDeliveryProviderError | undefined;
        for (const identity of standby) {
          if (!(yield* providerCircuitAllow(identity.provider.id))) {
            continue;
          }
          const result = yield* trySendWithIdentity(identity, sendInput);
          if (result.ok) {
            yield* markSent(db, {
              deliveryId: loaded.id,
              messageId: loaded.messageId,
              messageTags: message.tags,
              organizationId: appEnvironment.organizationId,
              providerId: result.providerId,
              providerMessageId: result.providerMessageId,
            });
            return;
          }
          lastError = result.error;
        }

        const failureMessage = lastError?.message ?? "All providers failed";
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* updateDelivery(tx, loaded.id, {
              completedAt: new Date(),
              error: { message: failureMessage, retryable: true },
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
                  })
              )
            );
          })
        );

        return yield* new MessageDeliveryRetryableError({
          cause: lastError,
          deliveryId: loaded.id,
          message: failureMessage,
          stage: "send",
        });
      }).pipe(
        Effect.mapError((error) => {
          switch (error._tag) {
            case "MessageDeliveryRetryableError":
            case "MessageDeliveryInfrastructureError":
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
        })
      ),
    classifyFailure: (failure) => {
      switch (failure._tag) {
        case "MessageDeliveryRetryableError":
        case "MessageDeliveryInfrastructureError":
        case "EmailDeliveryPersistenceError":
          return "retryable";
        default:
          return "terminal";
      }
    },
    onDeadLetter: ({ deliveryId }) =>
      Effect.gen(function* () {
        const usage = yield* Usage;
        yield* usage.release({ deliveryId });
      }).pipe(Effect.ignore),
  });
