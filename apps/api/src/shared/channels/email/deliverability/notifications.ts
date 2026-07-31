import type { NormalizedDeliveryEvent } from "@repo/api/channels/email/types";
import type { ContactSuppressionReason, DbOrTx } from "@repo/api/db";
import { schema } from "@repo/api/db";
import {
  emitWebhookEvent,
  resolveOrganizationIdForAppEnvironment,
  type WebhookEventType,
} from "@repo/api/messages/webhooks";
import type { RedisClient } from "bun";
import { and, eq, isNull, sql } from "drizzle-orm";

const DELIVERY_EVENT_WEBHOOK_TYPE = {
  accepted: "delivery.accepted",
  delivered: "delivery.delivered",
  delivery_delayed: "delivery.delivery_delayed",
  bounced: "delivery.bounced",
  complained: "delivery.complained",
  opened: "delivery.opened",
  clicked: "delivery.clicked",
} as const satisfies Record<string, WebhookEventType>;

export async function ingestDeliveryEvents({
  db,
  redis,
  events,
}: {
  db: DbOrTx;
  redis: RedisClient;
  events: NormalizedDeliveryEvent[];
}) {
  for (const event of events) {
    const delivery = await db.query.emailDelivery.findFirst({
      where: (table, { eq: equals }) =>
        equals(table.providerMessageId, event.providerMessageId),
      with: {
        message: true,
      },
    });

    if (!delivery) {
      continue;
    }

    await db.insert(schema.emailDeliveryEvent).values({
      emailDeliveryId: delivery.id,
      customDomainId: delivery.customDomainId,
      sandboxDomainId: delivery.sandboxDomainId,
      providerId: delivery.providerId,
      kind: event.kind,
      data: event.raw as Record<string, unknown>,
    });

    const organizationId = await resolveOrganizationIdForAppEnvironment({
      db,
      organizationAppEnvironmentId:
        delivery.message.organizationAppEnvironmentId,
    });

    if (organizationId) {
      const type = DELIVERY_EVENT_WEBHOOK_TYPE[event.kind];
      if (type) {
        await emitWebhookEvent({
          db,
          redis,
          organizationId,
          type,
          messageTags: delivery.message.tags,
          payload: {
            message_id: delivery.messageId,
            delivery_id: delivery.id,
            provider_message_id: event.providerMessageId,
            recipients: event.recipients,
            kind: event.kind,
          },
        });
      }
    }

    if (!event.suppress || event.recipients.length === 0) {
      continue;
    }

    const suppressionReason = (
      event.kind === "complained" ? "complaint" : "hard_bounce"
    ) satisfies ContactSuppressionReason;

    for (const recipientEmail of event.recipients) {
      await db
        .update(schema.contact)
        .set({
          suppressionReason,
          suppressedAt: new Date(),
        })
        .where(
          and(
            eq(
              schema.contact.organizationAppEnvironmentId,
              delivery.message.organizationAppEnvironmentId
            ),
            sql`lower(${schema.contact.email}) = ${recipientEmail.toLowerCase()}`,
            isNull(schema.contact.suppressionReason)
          )
        );
    }
  }
}
