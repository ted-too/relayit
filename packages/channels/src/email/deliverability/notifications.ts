import type { Database, DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  type ContactSuppressionSeverity,
  contact,
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
import { Data, Effect } from "effect";
import { normalizeContactEmail } from "../../messages/accept/contacts";
import type { NormalizedDeliveryEvent } from "../provider-webhook";

const deliveryOutcomeEvent = (
  event: NormalizedDeliveryEvent,
  input: {
    readonly deliveryId: string;
    readonly messageId: string;
  }
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

export class DeliveryEventIngestError extends Data.TaggedError(
  "DeliveryEventIngestError"
)<{
  readonly cause: unknown;
  readonly operation:
    | "emit_webhook"
    | "insert_event"
    | "load_delivery"
    | "load_organization"
    | "suppress_contact";
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
          })
      )
    );

const loadOrganizationId = (
  db: DatabaseExecutor,
  input: {
    readonly organizationAppEnvironmentId: string;
    readonly providerMessageId: string;
  }
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
          })
      ),
      Effect.map((row) => row?.organizationId)
    );

const suppressContacts = (
  db: DatabaseExecutor,
  input: {
    readonly event: NormalizedDeliveryEvent;
    readonly organizationAppEnvironmentId: string;
    readonly suppressionReason: "complaint" | "hard_bounce";
    readonly suppressionSeverity: ContactSuppressionSeverity;
  }
) => {
  const suppressedAt = new Date();

  return Effect.forEach(
    input.event.recipients,
    (recipient) => {
      const scope = and(
        eq(
          contact.organizationAppEnvironmentId,
          input.organizationAppEnvironmentId
        ),
        sql`lower(${contact.email}) = ${normalizeContactEmail(recipient)}`
      );
      // Hard bounce may upgrade marketing → all. Complaint must not downgrade all.
      const where =
        input.suppressionSeverity === "all"
          ? scope
          : and(scope, isNull(contact.suppressionReason));

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
                providerMessageId: input.event.providerMessageId,
              })
          )
        );
    },
    { concurrency: 1, discard: true }
  );
};

const ingestOne = (db: Database, event: NormalizedDeliveryEvent) =>
  Effect.gen(function* () {
    const delivery = yield* loadDelivery(db, event.providerMessageId);
    const message = delivery?.message;
    if (!(delivery && message)) {
      return;
    }

    yield* db
      .insert(emailDeliveryEvent)
      .values({
        customDomainId: delivery.customDomainId,
        data: event.raw as Record<string, unknown>,
        emailDeliveryId: delivery.id,
        kind: event.kind,
        providerId: delivery.providerId,
        sandboxDomainId: delivery.sandboxDomainId,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new DeliveryEventIngestError({
              cause,
              operation: "insert_event",
              providerMessageId: event.providerMessageId,
            })
        )
      );

    const organizationId = yield* loadOrganizationId(db, {
      organizationAppEnvironmentId: message.organizationAppEnvironmentId,
      providerMessageId: event.providerMessageId,
    });

    if (organizationId) {
      yield* db
        .transaction((tx) =>
          emitWebhookEvent(tx, {
            event: deliveryOutcomeEvent(event, {
              deliveryId: delivery.id,
              messageId: delivery.messageId,
            }),
            messageTags: message.tags,
            organizationId,
          })
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeliveryEventIngestError({
                cause,
                operation: "emit_webhook",
                providerMessageId: event.providerMessageId,
              })
          )
        );
    }

    if (
      event.suppress &&
      event.recipients.length > 0 &&
      (event.kind === "bounced" || event.kind === "complained")
    ) {
      yield* suppressContacts(db, {
        event,
        organizationAppEnvironmentId: message.organizationAppEnvironmentId,
        suppressionReason:
          event.kind === "complained" ? "complaint" : "hard_bounce",
        suppressionSeverity: event.kind === "complained" ? "marketing" : "all",
      });
    }
  });

export const ingestDeliveryEvents = (
  db: Database,
  input: {
    readonly events: readonly NormalizedDeliveryEvent[];
  }
) =>
  Effect.forEach(input.events, (event) => ingestOne(db, event), {
    concurrency: 1,
    discard: true,
  });
