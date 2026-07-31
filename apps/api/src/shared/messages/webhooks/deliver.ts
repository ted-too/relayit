import { schema } from "@repo/api/db";
import { QueueTerminalError, queue } from "@repo/api/queue";
import { logger } from "@repo/api/utils";
import type { RedisClient } from "bun";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { signWebhookPayload } from "./sign";
import { WEBHOOK_HTTP_MAX_ATTEMPTS } from "./types";

const deliveryPayload = z.object({
  webhookEventDeliveryId: z.string().min(1),
});

function backoffMs(attempt: number) {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

/**
 * HTTP POST a Webhook Event Delivery to its Endpoint.
 */
const http = queue({
  id: "webhook.deliver",
  payload: deliveryPayload,
  retry: {
    maxAttempts: WEBHOOK_HTTP_MAX_ATTEMPTS,
    backoff: { baseMs: 30_000, maxMs: 60 * 60_000 },
  },
  async process(payload, ctx) {
    const row = await ctx.db.query.webhookEventDelivery.findFirst({
      where: (table, { eq: equals }) =>
        equals(table.id, payload.webhookEventDeliveryId),
      with: {
        event: true,
        endpoint: true,
      },
    });

    if (!row) {
      throw new QueueTerminalError(
        `Webhook Event Delivery ${payload.webhookEventDeliveryId} not found`
      );
    }

    if (row.status === "delivered") {
      return;
    }

    if (row.status === "held") {
      return;
    }

    if (row.status === "dead_letter") {
      throw new QueueTerminalError(
        `Webhook Event Delivery ${row.id} is dead-lettered`
      );
    }

    if (!row.endpoint.enabled) {
      await ctx.db
        .update(schema.webhookEventDelivery)
        .set({ status: "held", nextAttemptAt: null })
        .where(eq(schema.webhookEventDelivery.id, row.id));
      return;
    }

    const body = JSON.stringify({
      type: row.event.type,
      created_at: row.event.createdAt.toISOString(),
      data: row.event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload({
      secret: row.endpoint.signingSecret,
      idempotencyId: row.event.idempotencyId,
      timestamp,
      body,
    });

    const attempts = row.attempts + 1;

    let response: Response;
    try {
      response = await fetch(row.endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-id": row.event.idempotencyId,
          "webhook-timestamp": String(timestamp),
          "webhook-signature": signature,
        },
        body,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Webhook HTTP request failed";
      await ctx.db
        .update(schema.webhookEventDelivery)
        .set({
          attempts,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        })
        .where(eq(schema.webhookEventDelivery.id, row.id));

      if (attempts >= WEBHOOK_HTTP_MAX_ATTEMPTS) {
        await ctx.db
          .update(schema.webhookEventDelivery)
          .set({ status: "dead_letter", nextAttemptAt: null })
          .where(eq(schema.webhookEventDelivery.id, row.id));
        throw new QueueTerminalError(message);
      }

      throw error instanceof Error ? error : new Error(message);
    }

    if (response.ok) {
      await ctx.db
        .update(schema.webhookEventDelivery)
        .set({
          status: "delivered",
          attempts,
          lastError: null,
          nextAttemptAt: null,
          deliveredAt: new Date(),
        })
        .where(eq(schema.webhookEventDelivery.id, row.id));
      return;
    }

    const lastError = `HTTP ${response.status}`;
    await ctx.db
      .update(schema.webhookEventDelivery)
      .set({
        attempts,
        lastError,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
      })
      .where(eq(schema.webhookEventDelivery.id, row.id));

    if (attempts >= WEBHOOK_HTTP_MAX_ATTEMPTS) {
      await ctx.db
        .update(schema.webhookEventDelivery)
        .set({ status: "dead_letter", nextAttemptAt: null })
        .where(eq(schema.webhookEventDelivery.id, row.id));
      throw new QueueTerminalError(lastError);
    }

    throw new Error(lastError);
  },
  hooks: {
    async onTerminalFail({ payload, ctx }) {
      await ctx.db
        .update(schema.webhookEventDelivery)
        .set({ status: "dead_letter", nextAttemptAt: null })
        .where(
          eq(schema.webhookEventDelivery.id, payload.webhookEventDeliveryId)
        );
      logger.warn(
        { webhookEventDeliveryId: payload.webhookEventDeliveryId },
        "Webhook Event Delivery entered dead-letter"
      );
    },
  },
});

export const webhookDeliverQueue = {
  http,
};

export async function enqueueWebhookDelivery(
  redis: RedisClient,
  webhookEventDeliveryId: string
) {
  await webhookDeliverQueue.http.with(redis).enqueue({
    webhookEventDeliveryId,
  });
}
