import { Jobs } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import { emailDelivery, message } from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import { contactUpdated, messageScheduled } from "@repo/webhooks/events";
import { eq } from "drizzle-orm";
import { Data, DateTime, Effect, Result, Schedule } from "effect";
import { typeid } from "typeid-js";
import {
  findMessageReplay,
  mergeMessageContacts,
  recordMessageIdempotency,
  resolveAppEnvironment,
  upsertMessageContacts,
} from "../../messages/accept";
import { filterSuppressedContacts } from "../../messages/suppressions";
import { Usage } from "../../usage";
import { isBlockedAttachmentFilename } from "../attachment-policy";
import { emailDeliverJob } from "../delivery/job";
import {
  deleteStagedEmailAttachments,
  resolveEmailAttachments,
  type StagedEmailAttachment,
  stageEmailAttachments,
} from "./attachments";
import { prepareEmailContent } from "./content";
import type {
  AcceptedTransactionalEmail,
  AcceptTransactionalEmailInput,
} from "./contracts";
import {
  EmailAcceptInfrastructureError,
  EmailAcceptPersistenceError,
  EmailAcceptRejected,
} from "./errors";
import {
  assertSandboxRecipientsAreMembers,
  resolveEmailProviderKind,
  resolveEmailSender,
} from "./policy";

class ConcurrentEmailAcceptReplay extends Data.TaggedError(
  "ConcurrentEmailAcceptReplay"
)<{
  readonly messageId: string;
}> {}

const compensationRetry = Schedule.recurs(2).pipe(
  Schedule.addDelay(() => Effect.succeed("100 millis"))
);

const findAcceptedEmail = (db: Effect.Success<typeof DB>, messageId: string) =>
  db
    .select({ deliveryId: emailDelivery.id })
    .from(emailDelivery)
    .where(eq(emailDelivery.messageId, messageId))
    .limit(1)
    .pipe(
      Effect.map(([delivery]) =>
        delivery
          ? ({
              deliveryId: delivery.deliveryId,
              messageId,
              replayed: true,
              stripped: [],
            } satisfies AcceptedTransactionalEmail)
          : undefined
      ),
      Effect.mapError(
        (cause) =>
          new EmailAcceptPersistenceError({
            cause,
            messageId,
            operation: "find_email_delivery",
          })
      )
    );

const findAcceptedEmailWithRetry = (
  db: Effect.Success<typeof DB>,
  messageId: string
) =>
  findAcceptedEmail(db, messageId).pipe(
    Effect.flatMap((accepted) =>
      accepted
        ? Effect.succeed(accepted)
        : Effect.fail(
            new EmailAcceptPersistenceError({
              cause: new Error(
                `Accepted Email Delivery was not found for Message ${messageId}`
              ),
              messageId,
              operation: "find_email_delivery",
            })
          )
    ),
    Effect.retry(compensationRetry),
    Effect.orElseSucceed(
      () => undefined as AcceptedTransactionalEmail | undefined
    )
  );

const compensateAcceptFailure = (
  usage: Effect.Success<typeof Usage>,
  deliveryId: string,
  stagedAttachments: readonly StagedEmailAttachment[]
) =>
  Effect.gen(function* () {
    yield* usage.release({ deliveryId }).pipe(
      Effect.retry(compensationRetry),
      Effect.tapError((error) =>
        Effect.logError("Failed to release Usage after accept failure").pipe(
          Effect.annotateLogs({
            deliveryId,
            error: String(error),
          })
        )
      ),
      Effect.ignore
    );
    yield* deleteStagedEmailAttachments(stagedAttachments).pipe(
      Effect.retry(compensationRetry),
      Effect.tapError((error) =>
        Effect.logError(
          "Failed to delete staged Attachments after accept failure"
        ).pipe(
          Effect.annotateLogs({
            deliveryId,
            error: String(error),
            stagedCount: stagedAttachments.length,
          })
        )
      ),
      Effect.ignore
    );
  });

export const acceptTransactionalEmail = (
  input: AcceptTransactionalEmailInput
) => {
  const recipientCount =
    input.email.to.length + input.email.cc.length + input.email.bcc.length;
  if (recipientCount === 0) {
    return Effect.fail(
      new EmailAcceptRejected({
        code: "no_recipients",
        message: "At least one recipient is required",
      })
    );
  }

  const blockedAttachment = input.email.attachments.find((attachment) =>
    isBlockedAttachmentFilename(attachment.filename)
  );
  if (blockedAttachment) {
    return Effect.fail(
      new EmailAcceptRejected({
        code: "invalid_attachment",
        details: {
          filename: blockedAttachment.filename,
          reason: "blocked_extension",
        },
        message: "This file type isn't allowed for security reasons.",
      })
    );
  }

  return Effect.gen(function* () {
    const db = yield* DB;
    const usage = yield* Usage;
    const jobs = yield* Jobs;
    const now = yield* DateTime.now;
    const reservedAt = DateTime.toDate(now).toISOString();

    if (input.idempotencyKey) {
      const replayMessageId = yield* findMessageReplay(db, {
        key: input.idempotencyKey,
        now,
        organizationId: input.organizationId,
      });
      if (replayMessageId) {
        const accepted = yield* findAcceptedEmail(db, replayMessageId);
        if (accepted) {
          return accepted;
        }
      }
    }

    const content = yield* prepareEmailContent(db, {
      content: input.email.content,
      organizationId: input.organizationId,
    });
    const sender = yield* resolveEmailSender(db, {
      fromAddress: input.email.from.address,
      organizationId: input.organizationId,
    });
    const appEnvironment = yield* resolveAppEnvironment(db, input);
    const to = yield* filterSuppressedContacts(db, {
      organizationAppEnvironmentId: appEnvironment.id,
      organizationId: input.organizationId,
      recipients: input.email.to,
    }).pipe(
      Effect.mapError(
        (error) =>
          new EmailAcceptInfrastructureError({
            cause: error.cause,
            operation: "suppressions",
            organizationId: input.organizationId,
          })
      )
    );
    const cc = yield* filterSuppressedContacts(db, {
      organizationAppEnvironmentId: appEnvironment.id,
      organizationId: input.organizationId,
      recipients: input.email.cc,
    }).pipe(
      Effect.mapError(
        (error) =>
          new EmailAcceptInfrastructureError({
            cause: error.cause,
            operation: "suppressions",
            organizationId: input.organizationId,
          })
      )
    );
    const bcc = yield* filterSuppressedContacts(db, {
      organizationAppEnvironmentId: appEnvironment.id,
      organizationId: input.organizationId,
      recipients: input.email.bcc,
    }).pipe(
      Effect.mapError(
        (error) =>
          new EmailAcceptInfrastructureError({
            cause: error.cause,
            operation: "suppressions",
            organizationId: input.organizationId,
          })
      )
    );
    const recipients = [...to.kept, ...cc.kept, ...bcc.kept];
    if (recipients.length === 0) {
      return yield* new EmailAcceptRejected({
        code: "all_recipients_suppressed",
        message:
          "Every recipient is suppressed at severity all; no deliverable addresses remain.",
      });
    }
    if (sender.kind === "sandbox") {
      yield* assertSandboxRecipientsAreMembers(db, {
        organizationId: input.organizationId,
        recipients,
      });
    }

    const providerKind = yield* resolveEmailProviderKind(
      db,
      input.organizationId,
      sender
    );
    const attachments = yield* resolveEmailAttachments(
      input.email.attachments,
      input.organizationId
    );
    const deliveryId = typeid("edlv").toString();
    const messageId = typeid("msg").toString();
    const policy = yield* usage.reserve({
      channel: "email",
      deliveryId,
      organizationId: input.organizationId,
      providerKind,
      purpose: "transactional",
      reservedAt,
    });

    let stagedAttachments: readonly StagedEmailAttachment[] = [];
    const transaction = db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .insert(message)
          .values({
            id: messageId,
            organizationAppEnvironmentId: appEnvironment.id,
            purpose: "transactional",
            scheduledAt: input.scheduledAt
              ? DateTime.toDate(input.scheduledAt)
              : null,
            tags: input.tags,
            templateId: content.templateId ?? null,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new EmailAcceptPersistenceError({
                  cause,
                  messageId,
                  operation: "insert_message",
                })
            )
          );
        yield* tx
          .insert(emailDelivery)
          .values({
            bcc: bcc.kept.map(({ email }) => email),
            cc: cc.kept.map(({ email }) => email),
            from: input.email.from,
            headers: input.email.headers,
            html: content.html ?? null,
            id: deliveryId,
            messageId,
            replyTo: [...input.email.replyTo],
            status: "queued",
            subject: content.subject,
            text: content.text ?? null,
            to: to.kept.map(({ email }) => email),
            ...(sender.kind === "custom"
              ? { customDomainId: sender.customDomainId }
              : { sandboxDomainId: sender.sandboxDomainId }),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new EmailAcceptPersistenceError({
                  cause,
                  messageId,
                  operation: "insert_email_delivery",
                })
            )
          );

        stagedAttachments = yield* stageEmailAttachments(tx, {
          attachments,
          deliveryId,
          now,
          organizationId: input.organizationId,
          scheduledAt: input.scheduledAt,
        });
        const contacts = mergeMessageContacts(recipients);
        yield* upsertMessageContacts(tx, {
          contacts,
          now,
          organizationAppEnvironmentId: appEnvironment.id,
        });

        if (input.idempotencyKey) {
          const recorded = yield* recordMessageIdempotency(tx, {
            key: input.idempotencyKey,
            messageId,
            now,
            organizationId: input.organizationId,
          });
          if (recorded.kind === "replay") {
            return yield* new ConcurrentEmailAcceptReplay({
              messageId: recorded.messageId,
            });
          }
        }

        yield* jobs.enqueue(
          emailDeliverJob,
          {
            billingUserId: policy.billingUserId,
            deliveryId,
            providerKind,
            purpose: "transactional",
            startDate: reservedAt,
          },
          tx,
          input.scheduledAt
            ? { delayUntil: DateTime.toEpochMillis(input.scheduledAt) }
            : undefined
        );

        if (input.scheduledAt) {
          yield* emitWebhookEvent(tx, {
            event: {
              data: {
                delivery_id: deliveryId,
                message_id: messageId,
                scheduled_at: DateTime.toDate(input.scheduledAt).toISOString(),
              },
              type: messageScheduled.type,
            },
            messageTags: input.tags,
            organizationId: input.organizationId,
          });
        }
        yield* Effect.forEach(
          contacts,
          (recipient) =>
            emitWebhookEvent(tx, {
              event: {
                data: {
                  email: recipient.email,
                  message_id: messageId,
                  source: "message.accept",
                },
                type: contactUpdated.type,
              },
              organizationId: input.organizationId,
            }),
          { concurrency: 1, discard: true }
        );
      })
    );

    const result = yield* Effect.result(transaction);
    if (Result.isFailure(result)) {
      yield* compensateAcceptFailure(usage, deliveryId, stagedAttachments);
      if (result.failure instanceof ConcurrentEmailAcceptReplay) {
        const accepted = yield* findAcceptedEmailWithRetry(
          db,
          result.failure.messageId
        );
        if (accepted) {
          return accepted;
        }
      }
      return yield* result.failure;
    }

    return {
      deliveryId,
      messageId,
      replayed: false,
      stripped: [...to.stripped, ...cc.stripped, ...bcc.stripped].map(
        (recipient) => ({
          email: recipient.email,
          reason: "suppression" as const,
        })
      ),
    } satisfies AcceptedTransactionalEmail;
  });
};
