import { Schema } from "effect";
import { defineWebhookEvent, type WebhookEventInput } from "./definition";

export const messageScheduled = defineWebhookEvent({
  payload: Schema.Struct({
    delivery_id: Schema.String,
    message_id: Schema.String,
    scheduled_at: Schema.String,
  }),
  type: "message.scheduled",
});

export const messageSent = defineWebhookEvent({
  payload: Schema.Struct({
    delivery_id: Schema.String,
    message_id: Schema.String,
    provider_message_id: Schema.String,
  }),
  type: "message.sent",
});

export const messageFailed = defineWebhookEvent({
  payload: Schema.Struct({
    delivery_id: Schema.String,
    error: Schema.String,
    message_id: Schema.String,
  }),
  type: "message.failed",
});

export type MessageWebhookEvent =
  | WebhookEventInput<typeof messageFailed>
  | WebhookEventInput<typeof messageScheduled>
  | WebhookEventInput<typeof messageSent>;
