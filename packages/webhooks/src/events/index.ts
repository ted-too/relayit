import { campaignSendCompleted } from "./campaign-send";
import { contactUpdated } from "./contact";
import type { WebhookEventInput } from "./definition";
import {
  deliveryAccepted,
  deliveryBounced,
  deliveryClicked,
  deliveryComplained,
  deliveryDelayed,
  deliveryDelivered,
  deliveryOpened,
  deliverySkipped,
} from "./delivery";
import { domainCreated, domainUpdated } from "./domain";
import { messageFailed, messageScheduled, messageSent } from "./message";

export {
  type CampaignSendWebhookEvent,
  campaignSendCompleted,
} from "./campaign-send";
export { type ContactWebhookEvent, contactUpdated } from "./contact";
export {
  defineWebhookEvent,
  type WebhookEventDefinition,
  type WebhookEventInput,
  type WebhookPayloadSchema,
} from "./definition";
export {
  type DeliveryWebhookEvent,
  deliveryAccepted,
  deliveryBounced,
  deliveryClicked,
  deliveryComplained,
  deliveryDelayed,
  deliveryDelivered,
  deliveryOpened,
  deliverySkipped,
} from "./delivery";
export {
  type DomainWebhookEvent,
  domainCreated,
  domainUpdated,
} from "./domain";
export {
  type MessageWebhookEvent,
  messageFailed,
  messageScheduled,
  messageSent,
} from "./message";

export const webhookEventDefinitions = {
  "delivery.accepted": deliveryAccepted,
  "delivery.delivered": deliveryDelivered,
  "delivery.delivery_delayed": deliveryDelayed,
  "delivery.bounced": deliveryBounced,
  "delivery.complained": deliveryComplained,
  "delivery.opened": deliveryOpened,
  "delivery.clicked": deliveryClicked,
  "delivery.skipped": deliverySkipped,
  "message.sent": messageSent,
  "message.scheduled": messageScheduled,
  "message.failed": messageFailed,
  "campaign_send.completed": campaignSendCompleted,
  "domain.created": domainCreated,
  "domain.updated": domainUpdated,
  "contact.updated": contactUpdated,
} as const;

type WebhookEventDefinitionCatalog = typeof webhookEventDefinitions;

export type WebhookEventType = keyof WebhookEventDefinitionCatalog;

export type WebhookEvent = WebhookEventInput<
  WebhookEventDefinitionCatalog[keyof WebhookEventDefinitionCatalog]
>;
