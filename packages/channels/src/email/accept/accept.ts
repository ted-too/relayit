import { Jobs } from "@repo/jobs";
import { type Database, DB } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDelivery,
  message,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import { contactUpdated, messageScheduled } from "@repo/webhooks/events";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Data, DateTime, Effect, Result, Schedule } from "effect";
import { typeid } from "typeid-js";
import {
  findMessageReplay,
  mergeMessageContacts,
  recordMessageIdempotency,
  resolveAppEnvironment,
  upsertMessageContacts,
} from "../../messages/accept";
import { filterSuppressedContacts } from "../../messages/suppressions";
import { Usage, type UsagePolicyResult } from "../../usage";
import { isBlockedAttachmentFilename } from "../attachment-policy";
import { emailDeliverJob } from "../delivery/job";
import {
  deleteStagedEmailAttachments,
  resolveEmailAttachments,
  type StagedEmailAttachment,
  stageEmailAttachments,
} from "./attachments";
import { prepareEmailContent } from "./content";
import type { AcceptedTransactionalEmail, AcceptTransactionalEmailInput } from "./contracts";
import {
  EmailAcceptInfrastructureError,
  EmailAcceptPersistenceError,
  EmailAcceptRejected,
} from "./errors";
import { assertSandboxRecipientsAreMembers, resolveEmailSender } from "./policy";

class ConcurrentEmailAcceptReplay extends Data.TaggedError("ConcurrentEmailAcceptReplay")<{
  readonly messageId: string;
}> {}

const compensationRetry = Schedule.recurs(2).pipe(
  Schedule.addDelay(() => Effect.succeed("100 millis")),
);

const findAcceptedEmail = (db: Database, messageId: string) =>
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
          : undefined,
      ),
      Effect.mapError(
        (cause) =>
          new EmailAcceptPersistenceError({
            cause,
            messageId,
            operation: "find_email_delivery",
          }),
      ),
    );

const findAcceptedEmailWithRetry = (db: Database, messageId: string) =>
  findAcceptedEmail(db, messageId).pipe(
    Effect.flatMap((accepted) =>
      accepted
        ? Effect.succeed(accepted)
        : Effect.fail(
            new EmailAcceptPersistenceError({
              cause: new Error(`Accepted Email Delivery was not found for Message ${messageId}`),
              messageId,
              operation: "find_email_delivery",
            }),
          ),
    ),
    Effect.retry(compensationRetry),
    Effect.orElseSucceed(() => undefined as AcceptedTransactionalEmail | undefined),
  );

const compensateAcceptFailure = (
  usage: Effect.Success<typeof Usage>,
  deliveryId: string,
  stagedAttachments: readonly StagedEmailAttachment[],
) =>
  Effect.gen(function* () {
    yield* usage.release({ deliveryId }).pipe(
      Effect.retry(compensationRetry),
      Effect.tapError((error) =>
        Effect.logError("Failed to release Usage after accept failure").pipe(
          Effect.annotateLogs({
            deliveryId,
            error: String(error),
          }),
        ),
      ),
      Effect.ignore,
    );
    yield* deleteStagedEmailAttachments(stagedAttachments).pipe(
      Effect.retry(compensationRetry),
      Effect.tapError((error) =>
        Effect.logError("Failed to delete staged Attachments after accept failure").pipe(
          Effect.annotateLogs({
            deliveryId,
            error: String(error),
            stagedCount: stagedAttachments.length,
          }),
        ),
      ),
      Effect.ignore,
    );
  });

export const acceptTransactionalEmail = (input: AcceptTransactionalEmailInput) => {
  const recipientCount = input.email.to.length + input.email.cc.length + input.email.bcc.length;
  if (recipientCount === 0) {
    return Effect.fail(
      new EmailAcceptRejected({
        code: "no_recipients",
        message: "At least one recipient is required",
      }),
    );
  }

  const blockedAttachment = input.email.attachments.find((attachment) =>
    isBlockedAttachmentFilename(attachment.filename),
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
      }),
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
      purpose: "transactional",
      recipients: input.email.to,
    }).pipe(
      Effect.mapError(
        (error) =>
          new EmailAcceptInfrastructureError({
            cause: error.cause,
            operation: "suppressions",
            organizationId: input.organizationId,
          }),
      ),
    );
    const cc = yield* filterSuppressedContacts(db, {
      organizationAppEnvironmentId: appEnvironment.id,
      organizationId: input.organizationId,
      purpose: "transactional",
      recipients: input.email.cc,
    }).pipe(
      Effect.mapError(
        (error) =>
          new EmailAcceptInfrastructureError({
            cause: error.cause,
            operation: "suppressions",
            organizationId: input.organizationId,
          }),
      ),
    );
    const bcc = yield* filterSuppressedContacts(db, {
      organizationAppEnvironmentId: appEnvironment.id,
      organizationId: input.organizationId,
      purpose: "transactional",
      recipients: input.email.bcc,
    }).pipe(
      Effect.mapError(
        (error) =>
          new EmailAcceptInfrastructureError({
            cause: error.cause,
            operation: "suppressions",
            organizationId: input.organizationId,
          }),
      ),
    );
    const recipients = [...to.kept, ...cc.kept, ...bcc.kept];
    if (recipients.length === 0) {
      return yield* new EmailAcceptRejected({
        code: "all_recipients_suppressed",
        message: "Every recipient is suppressed at severity all; no deliverable addresses remain.",
      });
    }
    if (sender.kind === "sandbox") {
      yield* assertSandboxRecipientsAreMembers(db, {
        organizationId: input.organizationId,
        recipients,
      });
    }

    const attachments = yield* resolveEmailAttachments(
      input.email.attachments,
      input.organizationId,
    );
    const deliveryId = typeid("edlv").toString();
    const messageId = typeid("msg").toString();
    let stagedAttachments: readonly StagedEmailAttachment[] = [];
    // Held by the accept's transaction until Postgres has finished committing it or rolled it
    // back, so whoever takes it afterwards reads a settled answer to "was the Message written".
    const acceptLock = sql`select pg_advisory_xact_lock(hashtextextended(${messageId}, 0))`;
    const transaction = (policy: UsagePolicyResult) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.execute(acceptLock).pipe(
            Effect.mapError(
              (cause) =>
                new EmailAcceptPersistenceError({
                  cause,
                  messageId,
                  operation: "lock_accept",
                }),
            ),
          );
          if (sender.kind === "custom") {
            // The sender was resolved before this transaction, and the Project's link to
            // the Domain may have gone since. Whatever takes a link holds the Domain's row
            // while it detaches the Project's Deliveries from it, so the row is taken here
            // first and the link read after: this Delivery is then written before that, and
            // detached with the rest, or not at all.
            const held = yield* tx
              .select({ id: customDomain.id })
              .from(customDomain)
              .where(eq(customDomain.id, sender.customDomainId))
              .for("key share")
              .pipe(
                Effect.andThen(
                  tx
                    .select({ organizationId: organizationDomain.organizationId })
                    .from(organizationDomain)
                    .where(
                      and(
                        eq(organizationDomain.customDomainId, sender.customDomainId),
                        eq(organizationDomain.organizationId, input.organizationId),
                        eq(organizationDomain.ownershipVerificationStatus, "verified"),
                      ),
                    ),
                ),
                Effect.mapError(
                  (cause) =>
                    new EmailAcceptPersistenceError({
                      cause,
                      messageId,
                      operation: "insert_email_delivery",
                    }),
                ),
              );
            if (held.length === 0) {
              return yield* new EmailAcceptRejected({
                code: "invalid_from_address",
                message: "The Project no longer holds the Domain of the From address.",
              });
            }
          }
          yield* tx
            .insert(message)
            .values({
              id: messageId,
              organizationAppEnvironmentId: appEnvironment.id,
              purpose: "transactional",
              scheduledAt: input.scheduledAt ? DateTime.toDate(input.scheduledAt) : null,
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
                  }),
              ),
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
                  }),
              ),
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
              purpose: "transactional",
              startDate: reservedAt,
            },
            tx,
            input.scheduledAt
              ? { delayUntil: DateTime.toEpochMillis(input.scheduledAt) }
              : undefined,
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
            { concurrency: 1, discard: true },
          );
        }),
      );

    // Usage is reserved before the transaction. If the accept then ends any way but success
    // (a failure, a defect, the client disconnecting, even mid-COMMIT or with COMMIT's answer
    // lost), whether the Message was written is read back once the transaction is over, and
    // only a Message that was not written gives back its Usage and staged objects. The read
    // first takes the accept's lock, so a COMMIT the server is still finishing (or has not
    // yet received from a connection that dropped) is waited for rather than read as "not
    // written". The read is tried three times, each waiting a second for the lock, so a
    // failing accept is held about three seconds at most. If the lock is not had in that
    // time or the read fails, nothing is given back: a leaked reservation is the safe side
    // of a committed send losing its attachments.
    let reserved = false;
    const result = yield* usage
      .reserve({
        channel: "email",
        deliveryId,
        organizationId: input.organizationId,
        purpose: "transactional",
        reservedAt,
      })
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            reserved = true;
          }),
        ),
        Effect.flatMap(transaction),
        Effect.onError((cause) =>
          // A reserve that failed made no reservation; an interrupted one may have.
          !reserved && !Cause.hasInterrupts(cause)
            ? Effect.void
            : db
                .transaction((tx) =>
                  Effect.gen(function* () {
                    yield* tx.execute(sql`set local lock_timeout = '1s'`);
                    yield* tx.execute(acceptLock);
                    return yield* tx
                      .select({ id: message.id })
                      .from(message)
                      .where(eq(message.id, messageId))
                      .limit(1);
                  }),
                )
                .pipe(
                  Effect.retry(compensationRetry),
                  Effect.matchEffect({
                    onFailure: (error) =>
                      Effect.logError(
                        "Could not tell whether an accept was written; keeping its Usage and attachments",
                        error,
                      ).pipe(Effect.annotateLogs({ deliveryId })),
                    onSuccess: ([written]) =>
                      written
                        ? Effect.void
                        : compensateAcceptFailure(usage, deliveryId, stagedAttachments),
                  }),
                ),
        ),
        Effect.result,
      );
    if (Result.isFailure(result)) {
      if (result.failure instanceof ConcurrentEmailAcceptReplay) {
        const accepted = yield* findAcceptedEmailWithRetry(db, result.failure.messageId);
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
      stripped: [...to.stripped, ...cc.stripped, ...bcc.stripped].map((recipient) => ({
        email: recipient.email,
        reason: "suppression" as const,
      })),
    } satisfies AcceptedTransactionalEmail;
  });
};
