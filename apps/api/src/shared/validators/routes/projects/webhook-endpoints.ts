import {
  WEBHOOK_EVENT_TYPE_SET,
  WEBHOOK_EVENT_TYPES,
} from "@repo/api/messages/webhooks";
import * as z from "zod";

const webhookEventTypeSchema = z
  .string()
  .refine((value) => WEBHOOK_EVENT_TYPE_SET.has(value), {
    message: `event type must be one of: ${WEBHOOK_EVENT_TYPES.join(", ")}`,
  });

export const createWebhookEndpointBodySchema = z.object({
  url: z.url(),
  eventTypes: z.array(webhookEventTypeSchema).default([]),
  tagFilter: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional().default(true),
});

export const updateWebhookEndpointBodySchema = z.object({
  url: z.url().optional(),
  eventTypes: z.array(webhookEventTypeSchema).optional(),
  tagFilter: z.record(z.string(), z.string()).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const webhookEndpointIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const webhookEventDeliveryIdParamsSchema = z.object({
  id: z.string().min(1),
  deliveryId: z.string().min(1),
});
