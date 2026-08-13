import { Schema } from "effect";
import { defineWebhookEvent, type WebhookEventInput } from "./definition";

export const campaignSendCompleted = defineWebhookEvent({
  payload: Schema.Struct({
    campaign_send_id: Schema.String,
    status: Schema.Literal("completed"),
  }),
  type: "campaign_send.completed",
});

export type CampaignSendWebhookEvent = WebhookEventInput<
  typeof campaignSendCompleted
>;
