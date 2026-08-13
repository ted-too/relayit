import { Schema } from "effect";
import { defineWebhookEvent, type WebhookEventInput } from "./definition";

export const contactUpdated = defineWebhookEvent({
  payload: Schema.Union([
    Schema.Struct({
      contact_id: Schema.String,
      email: Schema.String,
      source: Schema.Literal("contact.api"),
    }),
    Schema.Struct({
      email: Schema.String,
      message_id: Schema.String,
      source: Schema.Literal("message.accept"),
    }),
  ]),
  type: "contact.updated",
});

export type ContactWebhookEvent = WebhookEventInput<typeof contactUpdated>;
