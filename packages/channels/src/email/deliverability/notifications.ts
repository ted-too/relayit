import * as NodeCrypto from "node:crypto";
import type { Database, DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  type ContactSuppressionSeverity,
  contact,
  type EmailDeliveryEventKind,
  emailDeliveryEvent,
} from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import {
  type DeliveryWebhookEvent,
  deliveryAccepted,
  deliveryBounced,
  deliveryClicked,
  deliveryComplained,
  deliveryDelayed,
  deliveryDelivered,
  deliveryOpened,
} from "@repo/webhooks/events";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Clock, Data, Effect } from "effect";
import { TypeID } from "typeid-js";
import { normalizeContactEmail } from "../../messages/accept/contacts";

/** One outcome SES reported for a sent message, read from its notification. */
export interface NormalizedDeliveryEvent {
  readonly kind: EmailDeliveryEventKind;
  /** The SNS `MessageId` of the notification that carried it: one event per notification. */
  readonly notificationId: string;
  readonly providerMessageId: string;
  readonly raw: unknown;
  readonly recipients: readonly string[];
  /** When SES took the message (the notification's `mail.timestamp`), if it says. */
  readonly sentAt: Date | null;
  readonly suppress: boolean;
}

/**
 * How long after SES took a message a notification about it may find no Delivery and be
 * refused, so SNS sends it again. The worker records SES's message id a moment after SES
 * answers, or once Postgres is back; a notification can beat that write. Past this the id is
 * taken for one no Delivery will ever carry (a send whose answer never reached Relayit, or
 * mail this deployment did not send) and is acknowledged, so nothing makes SNS retry for ever.
 *
 * Refusing only helps while SNS still retries, so the retry policy the worker sets on the
 * notification topic is built from this number (`sesNotificationDeliveryPolicy` in
 * `packages/provider-aws`) to keep retrying for as long. An hour is the most SNS allows an
 * HTTP/S policy in all, so this cannot be raised.
 */
export const UNRECORDED_SEND_GRACE_SECONDS = 3600;

const deliveryOutcomeEvent = (
  event: NormalizedDeliveryEvent,
  input: {
    readonly deliveryId: string;
    readonly messageId: string;
  },
): Extract<
  DeliveryWebhookEvent,
  {
    readonly type:
      | "delivery.accepted"
      | "delivery.bounced"
      | "delivery.clicked"
      | "delivery.complained"
      | "delivery.delivered"
      | "delivery.delivery_delayed"
      | "delivery.opened";
  }
> => {
  const data = {
    delivery_id: input.deliveryId,
    message_id: input.messageId,
    provider_message_id: event.providerMessageId,
    recipients: [...event.recipients],
  };
  switch (event.kind) {
    case "accepted":
      return {
        data: { ...data, kind: "accepted" as const },
        type: deliveryAccepted.type,
      };
    case "delivered":
      return {
        data: { ...data, kind: "delivered" as const },
        type: deliveryDelivered.type,
      };
    case "delivery_delayed":
      return {
        data: { ...data, kind: "delivery_delayed" as const },
        type: deliveryDelayed.type,
      };
    case "bounced":
      return {
        data: { ...data, kind: "bounced" as const },
        type: deliveryBounced.type,
      };
    case "complained":
      return {
        data: { ...data, kind: "complained" as const },
        type: deliveryComplained.type,
      };
    case "opened":
      return {
        data: { ...data, kind: "opened" as const },
        type: deliveryOpened.type,
      };
    case "clicked":
      return {
        data: { ...data, kind: "clicked" as const },
        type: deliveryClicked.type,
      };
    default: {
      const _exhaustive: never = event.kind;
      return _exhaustive;
    }
  }
};

export class DeliveryEventIngestError extends Data.TaggedError("DeliveryEventIngestError")<{
  readonly cause: unknown;
  readonly operation:
    | "emit_webhook"
    | "insert_event"
    | "load_delivery"
    | "load_organization"
    | "suppress_contact";
  readonly providerMessageId: string;
}> {}

/** SES reported on a message sent so recently that its Delivery may not be recorded yet. */
export class DeliveryNotRecordedYet extends Data.TaggedError("DeliveryNotRecordedYet")<{
  readonly providerMessageId: string;
}> {}

const loadDelivery = (db: DatabaseExecutor, providerMessageId: string) =>
  db.query.emailDelivery
    .findFirst({
      where: { providerMessageId },
      with: {
        message: true,
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new DeliveryEventIngestError({
            cause,
            operation: "load_delivery",
            providerMessageId,
          }),
      ),
    );

const loadOrganizationId = (
  db: DatabaseExecutor,
  input: {
    readonly organizationAppEnvironmentId: string;
    readonly providerMessageId: string;
  },
) =>
  db.query.organizationAppEnvironment
    .findFirst({
      columns: { organizationId: true },
      where: { id: input.organizationAppEnvironmentId },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new DeliveryEventIngestError({
            cause,
            operation: "load_organization",
            providerMessageId: input.providerMessageId,
          }),
      ),
      Effect.map((row) => row?.organizationId),
    );

const suppressContacts = (
  db: DatabaseExecutor,
  input: {
    readonly organizationAppEnvironmentId: string;
    readonly providerMessageId: string;
    readonly recipients: readonly string[];
    readonly suppressionReason: "complaint" | "hard_bounce";
    readonly suppressionSeverity: ContactSuppressionSeverity;
  },
) => {
  const suppressedAt = new Date();

  return Effect.forEach(
    input.recipients,
    (recipient) => {
      const scope = and(
        eq(contact.organizationAppEnvironmentId, input.organizationAppEnvironmentId),
        sql`lower(${contact.email}) = ${normalizeContactEmail(recipient)}`,
      );
      // Hard bounce may upgrade marketing → all. Complaint must not downgrade all.
      const where =
        input.suppressionSeverity === "all" ? scope : and(scope, isNull(contact.suppressionReason));

      return db
        .update(contact)
        .set({
          suppressedAt,
          suppressionReason: input.suppressionReason,
          suppressionSeverity: input.suppressionSeverity,
        })
        .where(where)
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeliveryEventIngestError({
                cause,
                operation: "suppress_contact",
                providerMessageId: input.providerMessageId,
              }),
          ),
        );
    },
    { concurrency: 1, discard: true },
  );
};

const ingestOne = (db: Database, event: NormalizedDeliveryEvent) =>
  Effect.gen(function* () {
    const delivery = yield* loadDelivery(db, event.providerMessageId);
    const message = delivery?.message;
    if (!(delivery && message)) {
      // Failing leaves the notification with SNS, which sends it again; by then the worker
      // has recorded the send. A time in the future is no younger than one as far in the past.
      const now = yield* Clock.currentTimeMillis;
      if (
        event.sentAt &&
        Math.abs(now - event.sentAt.getTime()) < UNRECORDED_SEND_GRACE_SECONDS * 1000
      ) {
        return yield* new DeliveryNotRecordedYet({ providerMessageId: event.providerMessageId });
      }
      return;
    }

    const organizationId = yield* loadOrganizationId(db, {
      organizationAppEnvironmentId: message.organizationAppEnvironmentId,
      providerMessageId: event.providerMessageId,
    });

    // Only the Delivery's own recipients: a notification naming any other address must not
    // suppress it in this App Environment.
    const deliveryRecipients = new Set(
      [...delivery.to, ...(delivery.cc ?? []), ...(delivery.bcc ?? [])].map(normalizeContactEmail),
    );
    // Sorted, so concurrent notifications lock shared Contacts in the same order and cannot
    // deadlock.
    const suppressed = [
      ...new Set(event.recipients.map(normalizeContactEmail)).intersection(deliveryRecipients),
    ].toSorted();

    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        // The id is derived from the notification's SNS MessageId, so a redelivery, or a
        // retry after this transaction committed, collides with the event it already
        // recorded and adds no second Webhook Event or Suppression.
        const recorded = yield* tx
          .insert(emailDeliveryEvent)
          .values({
            customDomainId: delivery.customDomainId,
            data: event.raw as Record<string, unknown>,
            emailDeliveryId: delivery.id,
            id: TypeID.fromUUIDBytes(
              "edev",
              NodeCrypto.createHash("sha256").update(event.notificationId).digest().subarray(0, 16),
            ).toString(),
            kind: event.kind,
            sandboxDomainId: delivery.sandboxDomainId,
          })
          .onConflictDoNothing()
          .returning({ id: emailDeliveryEvent.id })
          .pipe(
            Effect.mapError(
              (cause) =>
                new DeliveryEventIngestError({
                  cause,
                  operation: "insert_event",
                  providerMessageId: event.providerMessageId,
                }),
            ),
          );
        if (recorded.length === 0) {
          return;
        }

        if (organizationId) {
          yield* emitWebhookEvent(tx, {
            event: deliveryOutcomeEvent(event, {
              deliveryId: delivery.id,
              messageId: delivery.messageId,
            }),
            messageTags: message.tags,
            organizationId,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new DeliveryEventIngestError({
                  cause,
                  operation: "emit_webhook",
                  providerMessageId: event.providerMessageId,
                }),
            ),
          );
        }

        if (
          event.suppress &&
          suppressed.length > 0 &&
          (event.kind === "bounced" || event.kind === "complained")
        ) {
          yield* suppressContacts(tx, {
            organizationAppEnvironmentId: message.organizationAppEnvironmentId,
            providerMessageId: event.providerMessageId,
            recipients: suppressed,
            suppressionReason: event.kind === "complained" ? "complaint" : "hard_bounce",
            suppressionSeverity: event.kind === "complained" ? "marketing" : "all",
          });
        }
      }),
    );
  });

export const ingestDeliveryEvents = (
  db: Database,
  input: {
    readonly events: readonly NormalizedDeliveryEvent[];
  },
) =>
  Effect.forEach(input.events, (event) => ingestOne(db, event), {
    concurrency: 1,
    discard: true,
  });
