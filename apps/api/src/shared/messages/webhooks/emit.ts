import { type DbOrTx, schema } from "@repo/api/db";
import type { RedisClient } from "bun";
import { typeid } from "typeid-js";
import { enqueueWebhookDelivery } from "./deliver";
import type { WebhookEventType } from "./types";

function endpointMatches({
  eventTypes,
  tagFilter,
  type,
  messageTags,
}: {
  eventTypes: string[];
  tagFilter: Record<string, string> | null | undefined;
  type: string;
  messageTags?: Record<string, string> | null;
}) {
  if (!eventTypes.includes(type)) {
    return false;
  }
  if (!tagFilter || Object.keys(tagFilter).length === 0) {
    return true;
  }
  const tags = messageTags ?? {};
  for (const [key, value] of Object.entries(tagFilter)) {
    if (tags[key] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Emit a Webhook Event when ≥1 Project Endpoint matches (enabled or disabled).
 * Otherwise a no-op — nothing persisted.
 */
export async function emitWebhookEvent({
  db,
  redis,
  organizationId,
  type,
  payload,
  messageTags,
  idempotencyId,
}: {
  db: DbOrTx;
  redis: RedisClient;
  organizationId: string;
  type: WebhookEventType;
  payload: Record<string, unknown>;
  messageTags?: Record<string, string> | null;
  /** Stable id; defaults to a new whevt-scoped token. */
  idempotencyId?: string;
}): Promise<{ eventId: string } | null> {
  const endpoints = await db.query.webhookEndpoint.findMany({
    where: (table, { eq: equals }) =>
      equals(table.organizationId, organizationId),
  });

  const matching = endpoints.filter((endpoint) =>
    endpointMatches({
      eventTypes: endpoint.eventTypes ?? [],
      tagFilter: endpoint.tagFilter,
      type,
      messageTags,
    })
  );

  if (matching.length === 0) {
    return null;
  }

  const [event] = await db
    .insert(schema.webhookEvent)
    .values({
      organizationId,
      type,
      idempotencyId: idempotencyId ?? typeid("whid").toString(),
      payload,
    })
    .returning();

  if (!event) {
    return null;
  }

  for (const endpoint of matching) {
    const status = endpoint.enabled ? "pending" : "held";
    const [delivery] = await db
      .insert(schema.webhookEventDelivery)
      .values({
        webhookEventId: event.id,
        webhookEndpointId: endpoint.id,
        status,
        nextAttemptAt: endpoint.enabled ? new Date() : null,
      })
      .returning();

    if (endpoint.enabled && delivery) {
      await enqueueWebhookDelivery(redis, delivery.id);
    }
  }

  return { eventId: event.id };
}

export async function resolveOrganizationIdForAppEnvironment({
  db,
  organizationAppEnvironmentId,
}: {
  db: DbOrTx;
  organizationAppEnvironmentId: string;
}): Promise<string | null> {
  const appEnvironment = await db.query.organizationAppEnvironment.findFirst({
    where: (table, { eq: equals }) =>
      equals(table.id, organizationAppEnvironmentId),
    columns: { organizationId: true },
  });
  return appEnvironment?.organizationId ?? null;
}
