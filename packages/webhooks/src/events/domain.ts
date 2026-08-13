import { Schema } from "effect";
import { defineWebhookEvent, type WebhookEventInput } from "./definition";

const domainStatus = Schema.Literals([
  "not_verified",
  "partially_verified",
  "verified",
]);

const domainPayload = Schema.Struct({
  domain_id: Schema.String,
  status: domainStatus,
});

export const domainCreated = defineWebhookEvent({
  payload: domainPayload,
  type: "domain.created",
});

export const domainUpdated = defineWebhookEvent({
  payload: domainPayload,
  type: "domain.updated",
});

export type DomainWebhookEvent =
  | WebhookEventInput<typeof domainCreated>
  | WebhookEventInput<typeof domainUpdated>;
