import { defineJobHandler } from "@repo/jobs";
import { type Database, type DatabaseExecutor, DB } from "@repo/persistence/db/effect";
import {
  contact,
  customDomain,
  emailDelivery,
  message as messageTable,
  organizationAppEnvironment,
  organizationDomain,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import { deliverySkipped, messageFailed, messageSent } from "@repo/webhooks/events";
import { Redis } from "@repo/redis";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { Clock, Duration, Effect, Schedule } from "effect";
import { normalizeContactEmail } from "../../messages/accept/contacts";
import {
  MessageDeliveryRetryableError,
  MessageDeliveryTerminalError,
} from "../../messages/delivery";
import { filterSuppressedContacts, suppressedAmong } from "../../messages/suppressions";
import { Usage } from "../../usage";
import { EmailBackend, type EmailBackendRejected } from "../backend";
import {
  lockProjectDomains,
  mergeListUnsubscribeHeadersForSend,
  pauseProjectDomains,
} from "../deliverability";
import { loadEmailAttachmentsForSend } from "./attachments";
import { EmailDeliveryPersistenceError } from "./errors";
import { emailDeliverJob } from "./job";

export interface EmailDeliverHandlerOptions {
  readonly secret: string;
  readonly apiOrigin: string;
}

/** What the Project reads in `message.failed` for each way a send can fail. */
const SES_REFUSED = "SES send failed";
const SES_REJECTED_MESSAGE = "SES rejected the message";
const OUTCOME_UNKNOWN = "The send was interrupted and its outcome is unknown; it is not sent again";

/**
 * SES answers within this or the send counts as unanswered: a hung connection must not hold
 * a worker slot, or its shutdown, for ever.
 */
const SES_SEND_TIMEOUT = Duration.seconds(30);

/**
 * How long a claim (`sending` since `startedAt`) belongs to the run that made it. Comfortably
 * longer than the SES timeout and the write after it, so a run that finds a claim this fresh
 * knows its owner may still be sending and retries later instead of failing it.
 */
const CLAIM_LEASE = Duration.minutes(2);

/**
 * How long a Delivery stays `sending` before the worker ends it without waiting for its job
 * (`endStuckDeliveries`). A job normally ends its own Delivery: the claim's owner within the
 * two-minute lease, a later attempt by reading the kept SES answer or, past the lease, failing
 * it, all inside the job's five attempts and seven and a half minutes of backoff. What is left
 * `sending` after that has lost its job, or its job is being held up, and nothing in the code
 * bounds how long that can last: an entry reclaimed from a crashed worker every minute and a
 * half, a dead-letter step that cannot write yet, a backlog, or no worker running. So the age
 * is a margin, not a derived limit, bounded above by the seven days SES's answer is kept: past
 * those, a send SES accepted could no longer be told from one it never answered.
 *
 * A day is about two hundred times the retry schedule and a seventh of that window. It is also
 * safe if the job does turn up later. On a claim older than its lease a run can only record a
 * kept acceptance as `sent`, or fail the Delivery, and the reconcile does the same from the
 * same answer under the same guarded write, so whichever is first, the other finds the outcome
 * written and adds nothing. The one difference: a refusal SES answered whose requeue was never
 * written is failed here, where a job with attempts left would have sent it again. That needs
 * the job held up for the whole day, which is why the age is a day and not an hour.
 */
const STUCK_SENDING_AGE = Duration.hours(24);

/**
 * How many times one run strips and claims before leaving the Delivery to the job's retry. A
 * second pass needs a Suppression or a pause to change between two of the run's statements,
 * so more than a few means something is flapping.
 */
const CLAIM_PASSES = 5;

/**
 * Whether a Delivery's sender may send right now, as conditions on the Delivery's own row: its
 * Domain is not paused and its Project still holds it (a claim another Project proved, or the
 * Project removing the Domain, ends that), or its Sandbox Domain is active and not paused. The
 * claim carries them in its `WHERE`, so no gap separates the check from the claim; a claim
 * that matched nothing reads them back to say why.
 *
 * A Delivery stops naming its Domain when its Project's link to it goes, so `domainHeld` asks
 * for a Sandbox Domain or a held Domain and never passes on a missing one. The Project adding
 * the same FQDN again does not revive it: that is another Domain.
 */
const senderMaySend = (organizationId: string) => ({
  domainHeld: sql<boolean>`(${emailDelivery.sandboxDomainId} is not null or exists (
    select 1 from ${organizationDomain}
    where ${organizationDomain.customDomainId} = ${emailDelivery.customDomainId}
      and ${organizationDomain.organizationId} = ${organizationId}
      and ${organizationDomain.ownershipVerificationStatus} = 'verified'))`,
  domainUnpaused: sql<boolean>`(${emailDelivery.customDomainId} is null or exists (
    select 1 from ${customDomain}
    where ${customDomain.id} = ${emailDelivery.customDomainId} and not ${customDomain.isPaused}))`,
  sandboxOpen: sql<boolean>`(${emailDelivery.sandboxDomainId} is null or exists (
    select 1 from ${sandboxDomain}
    where ${sandboxDomain.id} = ${emailDelivery.sandboxDomainId}
      and ${sandboxDomain.isActive} and not ${sandboxDomain.isPaused}))`,
});

/**
 * Writes `values` only while the Delivery is still in the state this run saw (`queued`, or
 * the claim made at `claimedAt`), so a run that lost a race never overwrites another's outcome.
 */
const updateDelivery = (
  db: DatabaseExecutor,
  delivery: { readonly id: string; readonly claimedAt: Date | null },
  values: Partial<typeof emailDelivery.$inferInsert>,
) =>
  db
    .update(emailDelivery)
    .set(values)
    .where(
      and(
        eq(emailDelivery.id, delivery.id),
        delivery.claimedAt
          ? and(
              eq(emailDelivery.status, "sending"),
              eq(emailDelivery.startedAt, delivery.claimedAt),
            )
          : eq(emailDelivery.status, "queued"),
      ),
    )
    .returning({ messageId: emailDelivery.messageId })
    .pipe(
      Effect.map(([updated]) => updated !== undefined),
      Effect.mapError(
        (cause) =>
          new EmailDeliveryPersistenceError({
            cause,
            deliveryId: delivery.id,
            operation: "update_status",
          }),
      ),
    );

/**
 * SES's answer to one claim: kept in Redis the moment it arrives, before Postgres, so a run
 * that finds the Delivery still `sending` (its write failed, or its worker died) finishes it
 * from the answer instead of sending again. Keyed by the claim, so an answer to an earlier
 * claim never speaks for a later one.
 */
const sesAnswerKey = (deliveryId: string, claimedAt: Date) =>
  `email:delivery:${deliveryId}:ses-answer:${claimedAt.getTime()}`;

const ACCEPTED = "accepted:";
const REFUSED = "refused";

const keepSesAnswer = (deliveryId: string, claimedAt: Date, answer: string) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    yield* redis.evaluateNumber({
      args: [answer, String(7 * 24 * 60 * 60)],
      keys: [sesAnswerKey(deliveryId, claimedAt)],
      script: 'redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2]) return 1',
    });
  }).pipe(
    // Postgres is written next; the answer only matters if that write fails too.
    Effect.catch((error) =>
      Effect.logError("Failed to keep SES's answer for a Delivery", error).pipe(
        Effect.annotateLogs({ deliveryId }),
      ),
    ),
  );

/** What a Delivery found `sending` is waiting on, from its claim's SES answer and age. */
const sendingState = (delivery: { readonly id: string; readonly startedAt: Date | null }) =>
  Effect.gen(function* () {
    const claimedAt = delivery.startedAt;
    if (!claimedAt) {
      return { claimedAt, kind: "stale" } as const;
    }
    const redis = yield* Redis;
    const answer = yield* redis
      .evaluateString({
        args: [],
        keys: [sesAnswerKey(delivery.id, claimedAt)],
        script: 'return redis.call("GET", KEYS[1]) or ""',
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageDeliveryRetryableError({
              cause,
              deliveryId: delivery.id,
              message: "SES's answer could not be read",
              stage: "send",
            }),
        ),
      );
    if (answer.startsWith(ACCEPTED)) {
      return {
        claimedAt,
        kind: "accepted",
        providerMessageId: answer.slice(ACCEPTED.length),
      } as const;
    }
    if (answer === REFUSED) {
      return { claimedAt, kind: "refused" } as const;
    }
    const now = yield* Clock.currentTimeMillis;
    return claimedAt.getTime() > now - Duration.toMillis(CLAIM_LEASE)
      ? ({ claimedAt, kind: "live" } as const)
      : ({ claimedAt, kind: "stale" } as const);
  });

/**
 * Records a Delivery SES has accepted as sent, with its message.sent event. Only the claim
 * SES answered changes, so recording it twice emits nothing twice.
 */
const recordSent = (
  db: Database,
  input: {
    readonly claimedAt: Date;
    readonly deliveryId: string;
    readonly messageId: string;
    readonly messageTags: Record<string, string> | null;
    readonly organizationId: string;
    readonly providerMessageId: string;
  },
) =>
  db
    .transaction((tx) =>
      Effect.gen(function* () {
        const sent = yield* updateDelivery(
          tx,
          { claimedAt: input.claimedAt, id: input.deliveryId },
          { completedAt: new Date(), providerMessageId: input.providerMessageId, status: "sent" },
        );
        if (!sent) {
          return;
        }
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
        });
      }),
    )
    .pipe(
      Effect.retry({ schedule: Schedule.exponential("200 millis"), times: 4 }),
      // SES's answer is in Redis: the retry finishes it from there.
      Effect.mapError(
        (cause) =>
          new MessageDeliveryRetryableError({
            cause,
            deliveryId: input.deliveryId,
            message: "SES accepted the send but it could not be recorded yet",
            stage: "record",
          }),
      ),
    );

/**
 * Usage is bookkeeping: once SES has a send, nothing here may fail the Delivery or send it
 * again. A Redis outage is retried through the job; a reservation Redis lost or already
 * released cannot be confirmed by retrying, so the send stands uncounted.
 */
const confirmUsage = (deliveryId: string) =>
  Effect.gen(function* () {
    const usage = yield* Usage;
    yield* usage.confirm({ deliveryId }).pipe(
      Effect.catch((error) => {
        switch (error._tag) {
          case "UsageInfrastructureError":
            return Effect.fail(
              new MessageDeliveryRetryableError({
                cause: error,
                deliveryId,
                message: "Usage could not be confirmed",
                stage: "usage",
              }),
            );
          default:
            return Effect.logError("Usage could not be confirmed for a sent Delivery", error).pipe(
              Effect.annotateLogs({ deliveryId }),
            );
        }
      }),
    );
  });

/** As `confirmUsage`, for a Delivery that ended without sending. */
const releaseUsage = (deliveryId: string) =>
  Effect.gen(function* () {
    const usage = yield* Usage;
    yield* usage.release({ deliveryId }).pipe(
      Effect.catch((error) => {
        switch (error._tag) {
          case "UsageInfrastructureError":
            return Effect.fail(
              new MessageDeliveryRetryableError({
                cause: error,
                deliveryId,
                message: "Usage could not be released",
                stage: "usage",
              }),
            );
          default:
            return Effect.logError("Usage could not be released for a Delivery", error).pipe(
              Effect.annotateLogs({ deliveryId }),
            );
        }
      }),
    );
  });

/**
 * Ends a Delivery `failed` with its `message.failed`, in one transaction and only while it is
 * still as it was read (`status`, and the claim made at `startedAt`). False when something
 * else moved it meanwhile: nothing is written then, so two that fail one Delivery at once
 * tell the Project once.
 */
const failDelivery = (
  db: Database,
  delivery: {
    readonly id: string;
    readonly messageId: string;
    readonly messageTags: Record<string, string> | null;
    readonly organizationId: string;
    readonly startedAt: Date | null;
    readonly status: "queued" | "sending";
  },
  failureMessage: string,
) =>
  db.transaction((tx) =>
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
            eq(emailDelivery.id, delivery.id),
            eq(emailDelivery.status, delivery.status),
            delivery.startedAt
              ? eq(emailDelivery.startedAt, delivery.startedAt)
              : isNull(emailDelivery.startedAt),
          ),
        )
        .returning({ id: emailDelivery.id });
      if (!failed) {
        return false;
      }
      yield* emitWebhookEvent(tx, {
        event: {
          data: {
            delivery_id: delivery.id,
            error: failureMessage,
            message_id: delivery.messageId,
          },
          type: messageFailed.type,
        },
        messageTags: delivery.messageTags,
        organizationId: delivery.organizationId,
      });
      return true;
    }),
  );

/**
 * Ends every Delivery left `sending` for longer than `STUCK_SENDING_AGE`, whose job is gone or
 * held up: `sent` when SES's kept answer says it took the send, otherwise `failed` with the
 * reason the job's dead-letter step would have given, `message.failed` and its Usage released.
 * The worker runs it as it starts and every hour after. Several workers may run it at once:
 * each write is guarded by the claim it read, so one of them ends a Delivery and the rest
 * find nothing to do.
 */
export const endStuckDeliveries = Effect.gen(function* () {
  const db = yield* DB;
  const now = yield* Clock.currentTimeMillis;
  const stuck = yield* db
    .select({
      id: emailDelivery.id,
      messageId: emailDelivery.messageId,
      messageTags: messageTable.tags,
      organizationId: organizationAppEnvironment.organizationId,
      startedAt: emailDelivery.startedAt,
    })
    .from(emailDelivery)
    .innerJoin(messageTable, eq(messageTable.id, emailDelivery.messageId))
    .innerJoin(
      organizationAppEnvironment,
      eq(organizationAppEnvironment.id, messageTable.organizationAppEnvironmentId),
    )
    .where(
      and(
        eq(emailDelivery.status, "sending"),
        lt(emailDelivery.startedAt, new Date(now - Duration.toMillis(STUCK_SENDING_AGE))),
      ),
    );

  yield* Effect.forEach(
    stuck,
    (delivery) =>
      Effect.gen(function* () {
        const state = yield* sendingState(delivery);
        let failureMessage: string;
        switch (state.kind) {
          case "accepted":
            yield* recordSent(db, {
              claimedAt: state.claimedAt,
              deliveryId: delivery.id,
              messageId: delivery.messageId,
              messageTags: delivery.messageTags,
              organizationId: delivery.organizationId,
              providerMessageId: state.providerMessageId,
            });
            return yield* confirmUsage(delivery.id);
          case "live":
            // Not reachable while the age is longer than the lease; its owner has it.
            return;
          case "refused":
            failureMessage = SES_REFUSED;
            break;
          case "stale":
            failureMessage = OUTCOME_UNKNOWN;
            break;
        }
        if (yield* failDelivery(db, { ...delivery, status: "sending" }, failureMessage)) {
          // No job runs again to make a release Redis refused, so it is retried here.
          yield* releaseUsage(delivery.id).pipe(
            Effect.retry({ schedule: Schedule.exponential("200 millis"), times: 4 }),
          );
          yield* Effect.logWarning("Ended a Delivery left sending without a job").pipe(
            Effect.annotateLogs({ reason: failureMessage }),
          );
        }
      }).pipe(
        // A worker shutting down finishes the Delivery it is on: the outcome with its Usage.
        Effect.uninterruptible,
        // One that cannot be ended yet waits for the next pass; the rest are still ended.
        Effect.catchCause((cause) => Effect.logError("Failed to end a stuck Delivery", cause)),
        Effect.annotateLogs({ deliveryId: delivery.id }),
      ),
    { discard: true },
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
                columns: { fqdn: true },
                with: { registration: true },
              },
              message: {
                with: { appEnvironment: { columns: { organizationId: true } } },
              },
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
        const appEnvironment = message.appEnvironment;
        if (!appEnvironment) {
          return yield* new MessageDeliveryTerminalError({
            deliveryId: loaded.id,
            message: "App Environment missing for Email Delivery",
            stage: "load",
          });
        }

        switch (loaded.status) {
          case "queued":
            break;
          case "sent":
            // SES has it: a retry or a duplicate job only finishes the bookkeeping.
            return yield* confirmUsage(loaded.id);
          case "sending": {
            // A claim this run did not make: another run is sending it, or one stopped
            // before Postgres had SES's answer. Never send it again from here.
            const state = yield* sendingState(loaded);
            switch (state.kind) {
              case "accepted":
                yield* recordSent(db, {
                  claimedAt: state.claimedAt,
                  deliveryId: loaded.id,
                  messageId: loaded.messageId,
                  messageTags: message.tags,
                  organizationId: appEnvironment.organizationId,
                  providerMessageId: state.providerMessageId,
                });
                return yield* confirmUsage(loaded.id);
              case "refused":
                // SES did not take it, so a later run may claim and send it again.
                yield* updateDelivery(
                  db,
                  { claimedAt: state.claimedAt, id: loaded.id },
                  {
                    startedAt: null,
                    status: "queued",
                  },
                );
                return yield* new MessageDeliveryRetryableError({
                  deliveryId: loaded.id,
                  message: SES_REFUSED,
                  stage: "send",
                });
              case "live":
                return yield* new MessageDeliveryRetryableError({
                  deliveryId: loaded.id,
                  message: "Another run is sending the Delivery",
                  stage: "claim",
                });
              case "stale":
                return yield* new MessageDeliveryTerminalError({
                  deliveryId: loaded.id,
                  message: OUTCOME_UNKNOWN,
                  stage: "send",
                });
            }
          }
          default:
            // skipped, canceled or failed: nothing to send. Its Usage goes back here too, so a
            // release the dead-letter step could not make is made when the job runs again.
            return yield* releaseUsage(loaded.id);
        }

        let attachments: Effect.Success<ReturnType<typeof loadEmailAttachmentsForSend>> | undefined;
        // A claim refused while the Delivery is still `queued` and its sender may send means what
        // this run checked changed before it claimed: a kept recipient was suppressed, or the
        // Suppression or pause that refused the claim was lifted before the run read why. No
        // other run holds it, so this one strips and claims again. A pass that only strips
        // leaves a recipient fewer, but one that follows a lifted Suppression or pause does
        // not, so nothing proves the passes end: hence the ceiling.
        for (let pass = 0; pass < CLAIM_PASSES; pass += 1) {
          const suppressionInput = {
            organizationAppEnvironmentId: message.organizationAppEnvironmentId,
            organizationId: appEnvironment.organizationId,
            // What accept wrote with the Delivery, not what the job says: a job that named
            // the wrong purpose must not get past a `marketing` Suppression.
            purpose: message.purpose,
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
                const skipped = yield* updateDelivery(
                  tx,
                  { claimedAt: null, id: loaded.id },
                  {
                    completedAt: new Date(),
                    error: {
                      details: { reason: "suppression" },
                      message: "All recipients suppressed",
                      retryable: false,
                    },
                    status: "skipped",
                  },
                );
                if (!skipped) {
                  return yield* new MessageDeliveryRetryableError({
                    deliveryId: loaded.id,
                    message: "Another run claimed the Delivery",
                    stage: "claim",
                  });
                }
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
            // Its Project's link to the Domain went while it was queued.
            return yield* new MessageDeliveryTerminalError({
              deliveryId: loaded.id,
              message: "The Project no longer holds the sending Domain",
              stage: "domain",
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

          attachments ??= yield* loadEmailAttachmentsForSend(db, loaded.id);

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
            apiOrigin: listUnsubscribe.apiOrigin,
          });

          const backend = yield* EmailBackend;
          const failProjectSendingPaused = (error: EmailBackendRejected, claimedAt: Date) =>
            Effect.gen(function* () {
              const failureMessage = "SES paused sending for this Project";
              yield* db.transaction((tx) =>
                Effect.gen(function* () {
                  const paused = {
                    defaultRegion: backend.defaultRegion,
                    organizationId: appEnvironment.organizationId,
                    region: registration.region ?? backend.defaultRegion,
                  };
                  // The Domains this will pause before the Delivery, as removing a Domain or
                  // taking it by a claim locks them, so neither waits on this while this
                  // waits on it; and all of them in one order, because SES refuses every
                  // send of a paused Project at once, each from a Domain of its own.
                  yield* lockProjectDomains(tx, paused).pipe(
                    Effect.mapError(
                      (cause) =>
                        new EmailDeliveryPersistenceError({
                          cause,
                          deliveryId: loaded.id,
                          operation: "update_status",
                        }),
                    ),
                  );
                  const failed = yield* updateDelivery(
                    tx,
                    { claimedAt, id: loaded.id },
                    {
                      completedAt: new Date(),
                      error: { message: failureMessage, retryable: false },
                      status: "failed",
                    },
                  );
                  if (!failed) {
                    return;
                  }
                  // SES pauses the Project, not a Domain: every Domain it holds in this region
                  // is refused from now on, and the same pause is what the api makes when SES
                  // reports the tenant's status, so whichever comes first tells the Project
                  // once. This one goes by the refusal, not by the status now: if SES restored
                  // the tenant meanwhile, the recheck job lifts it.
                  yield* pauseProjectDomains(tx, paused).pipe(
                    Effect.mapError(
                      (cause) =>
                        new EmailDeliveryPersistenceError({
                          cause,
                          deliveryId: loaded.id,
                          operation: "update_status",
                        }),
                    ),
                  );
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

          const sendMessage = {
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
          };

          // From the claim until SES's answer is kept nothing may interrupt the run, so a worker
          // shutting down finishes the send (bounded by the SES timeout) rather than leaving an
          // unknown outcome behind.
          const restrip = yield* Effect.uninterruptible(
            Effect.gen(function* () {
              // Only a run that moves it from `queued` may send it, and only while its sender may
              // send and no recipient this run kept is suppressed: a Domain paused or lost to
              // another Project since accept is never sent from, and a Contact a bounce or
              // complaint suppressed since the strip above is never sent to. The claim also
              // writes the recipients it sends to, so the Delivery names no one it stripped.
              const sender = senderMaySend(appEnvironment.organizationId);
              const recipientsUnsuppressed = sql<boolean>`not exists (select 1 from ${contact} where ${suppressedAmong(
                {
                  emails: [...toEmails, ...ccEmails, ...bccEmails].map(normalizeContactEmail),
                  organizationAppEnvironmentId: message.organizationAppEnvironmentId,
                  purpose: message.purpose,
                },
              )})`;
              const [claimed] = yield* db
                .update(emailDelivery)
                .set({
                  bcc: loaded.bcc && bccEmails,
                  cc: loaded.cc && ccEmails,
                  startedAt: new Date(yield* Clock.currentTimeMillis),
                  status: "sending",
                  to: toEmails,
                })
                .where(
                  and(
                    eq(emailDelivery.id, loaded.id),
                    eq(emailDelivery.status, "queued"),
                    sender.domainUnpaused,
                    sender.domainHeld,
                    sender.sandboxOpen,
                    recipientsUnsuppressed,
                  ),
                )
                .returning({ startedAt: emailDelivery.startedAt })
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
              // Read back, so this claim's SES answer is keyed exactly as later runs will see it.
              const claimedAt = claimed?.startedAt;
              if (!claimedAt) {
                // One read tells a sender that may not send from a claim another run made. The
                // dead-letter step records the first and tells the Project; a duplicate run of
                // the job retries later, to find what the other run did. A Delivery still
                // `queued` whose sender may send was refused for a recipient, or for something
                // lifted since: either way no run has it, so this one goes round again.
                const [unclaimed] = yield* db
                  .select({ status: emailDelivery.status, ...sender })
                  .from(emailDelivery)
                  .where(eq(emailDelivery.id, loaded.id))
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
                if (unclaimed?.status === "queued") {
                  if (!unclaimed.domainUnpaused) {
                    return yield* new MessageDeliveryTerminalError({
                      deliveryId: loaded.id,
                      message: "Domain is paused",
                      stage: "domain",
                    });
                  }
                  if (!unclaimed.sandboxOpen) {
                    return yield* new MessageDeliveryTerminalError({
                      deliveryId: loaded.id,
                      message: "Sandbox Domain is paused or inactive",
                      stage: "domain",
                    });
                  }
                  if (!unclaimed.domainHeld) {
                    return yield* new MessageDeliveryTerminalError({
                      deliveryId: loaded.id,
                      message: "The Project no longer holds the sending Domain",
                      stage: "domain",
                    });
                  }
                  return true;
                }
                return yield* new MessageDeliveryRetryableError({
                  deliveryId: loaded.id,
                  message: "Another run claimed the Delivery",
                  stage: "claim",
                });
              }

              const sent = yield* backend
                .send({ message: sendMessage, region: registration.region })
                .pipe(
                  // Interruptible by the timeout alone: the region still holds off a shutdown.
                  Effect.interruptible,
                  Effect.timeout(SES_SEND_TIMEOUT),
                  Effect.catch((error) => {
                    // SES refused it, or the request never reached SES (the backend reports a
                    // 4xx or a DNS, connect or TLS failure as rejected), so nothing went out:
                    // keep that answer and put the Delivery back as it was accepted. If the
                    // requeue is not written, the kept answer tells the next run so.
                    const refused = (
                      failure: MessageDeliveryRetryableError | MessageDeliveryTerminalError,
                    ) =>
                      keepSesAnswer(loaded.id, claimedAt, REFUSED).pipe(
                        Effect.andThen(
                          updateDelivery(
                            db,
                            { claimedAt, id: loaded.id },
                            { startedAt: null, status: "queued" },
                          ),
                        ),
                        Effect.ignore,
                        Effect.andThen(Effect.fail(failure)),
                      );
                    // What may pass by itself (a throttle, the account paused, credentials or
                    // configuration ops are changing, a network failure) is sent again later.
                    const retried = refused(
                      new MessageDeliveryRetryableError({
                        cause: error,
                        deliveryId: loaded.id,
                        message: SES_REFUSED,
                        stage: "send",
                      }),
                    );
                    // Nothing the job's few minutes of retries would change, so it fails now,
                    // through the dead-letter step. `MessageRejected` is SES refusing the
                    // content, and also SES not counting the sender (or, for an account still
                    // in SES's sandbox, a recipient) as verified in the region: a state of the
                    // Domain or the account that someone has to fix first.
                    const rejected = refused(
                      new MessageDeliveryTerminalError({
                        cause: error,
                        deliveryId: loaded.id,
                        message: SES_REJECTED_MESSAGE,
                        stage: "send",
                      }),
                    );
                    switch (error._tag) {
                      case "EmailBackendRejected":
                        switch (error.reason) {
                          // A Project Sending Pause is SES isolating this Project: retrying
                          // cannot get past it, and other Projects keep sending.
                          case "project_sending_paused":
                            return keepSesAnswer(loaded.id, claimedAt, REFUSED).pipe(
                              Effect.andThen(failProjectSendingPaused(error, claimedAt)),
                            );
                          case "message_rejected":
                            return rejected;
                          default:
                            return retried;
                        }
                      case "EmailBackendMessageError":
                        return rejected;
                      case "EmailBackendAuthenticationError":
                      case "EmailBackendConfigurationError":
                      case "EmailBackendRateLimited":
                        return retried;
                      default:
                        // Our timeout, a connection dropped after the request went out, a 5xx
                        // or an answer we could not read: SES may have taken it. It stays
                        // claimed, and once the claim is older than its lease a later run fails
                        // it rather than send twice.
                        return Effect.fail(
                          new MessageDeliveryRetryableError({
                            cause: error,
                            deliveryId: loaded.id,
                            message: "SES did not confirm the send; the outcome is unknown",
                            stage: "send",
                          }),
                        );
                    }
                  }),
                );

              yield* keepSesAnswer(loaded.id, claimedAt, `${ACCEPTED}${sent.providerMessageId}`);
              yield* recordSent(db, {
                claimedAt,
                deliveryId: loaded.id,
                messageId: loaded.messageId,
                messageTags: message.tags,
                organizationId: appEnvironment.organizationId,
                providerMessageId: sent.providerMessageId,
              });
              yield* confirmUsage(loaded.id);
              return false;
            }),
          );
          if (!restrip) {
            return;
          }
        }
        // Not stage `claim`: no other run has the Delivery, so on a last attempt the
        // dead-letter step must fail it rather than leave it to one.
        return yield* new MessageDeliveryRetryableError({
          deliveryId: loaded.id,
          message: "The Delivery's recipients or sender kept changing as it was claimed",
          stage: "suppressions",
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
    // ends failed here and the Project hears of it; one SES accepted ends sent. If that, or
    // the Usage that goes with it, cannot be written yet (Postgres or Redis down, or another
    // run's claim still live), this fails, so the job stays pending and runs again until it can.
    onDeadLetter: ({ deliveryId }, _execution, failure) =>
      Effect.gen(function* () {
        const db = yield* DB;
        const delivery = yield* db.query.emailDelivery.findFirst({
          columns: { id: true, messageId: true, startedAt: true, status: true },
          where: { id: deliveryId },
          with: {
            message: {
              columns: { tags: true },
              with: { appEnvironment: { columns: { organizationId: true } } },
            },
          },
        });
        const organizationId = delivery?.message?.appEnvironment?.organizationId;
        if (!delivery || !organizationId) {
          return yield* releaseUsage(deliveryId);
        }
        // Only text written for the Project reaches its message.failed.
        let failureMessage =
          failure._tag === "MessageDeliveryTerminalError" ||
          (failure._tag === "MessageDeliveryRetryableError" && failure.stage === "send")
            ? failure.message
            : "The Delivery could not be processed";
        switch (delivery.status) {
          case "sent":
            return yield* confirmUsage(deliveryId);
          case "sending": {
            const state = yield* sendingState(delivery);
            switch (state.kind) {
              case "accepted":
                yield* recordSent(db, {
                  claimedAt: state.claimedAt,
                  deliveryId,
                  messageId: delivery.messageId,
                  messageTags: delivery.message?.tags ?? null,
                  organizationId,
                  providerMessageId: state.providerMessageId,
                });
                return yield* confirmUsage(deliveryId);
              case "live":
                return yield* new MessageDeliveryRetryableError({
                  deliveryId,
                  message: "Another run is sending the Delivery",
                  stage: "claim",
                });
              case "refused":
                failureMessage = SES_REFUSED;
                break;
              case "stale":
                failureMessage = OUTCOME_UNKNOWN;
                break;
            }
            break;
          }
          case "queued":
            // A run that only lost the claim to another leaves the Delivery to that run,
            // which has retries of its own.
            if (failure._tag === "MessageDeliveryRetryableError" && failure.stage === "claim") {
              return;
            }
            break;
          default:
            // skipped, canceled or failed: the outcome is written.
            return yield* releaseUsage(deliveryId);
        }

        const failed = yield* failDelivery(
          db,
          {
            id: deliveryId,
            messageId: delivery.messageId,
            messageTags: delivery.message?.tags ?? null,
            organizationId,
            startedAt: delivery.startedAt,
            status: delivery.status,
          },
          failureMessage,
        );
        if (!failed) {
          // Another run moved it meanwhile; settle it on the next run.
          return yield* new MessageDeliveryRetryableError({
            deliveryId,
            message: "The Delivery changed while it was being failed",
            stage: "dead_letter",
          });
        }
        yield* releaseUsage(deliveryId);
      }),
  });
