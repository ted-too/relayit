/** Channel-agnostic Webhook Event type names (Messages CONTEXT). */
export const WEBHOOK_EVENT_TYPES = [
  "delivery.accepted",
  "delivery.delivered",
  "delivery.delivery_delayed",
  "delivery.bounced",
  "delivery.complained",
  "delivery.opened",
  "delivery.clicked",
  "delivery.skipped",
  "message.sent",
  "message.scheduled",
  "message.failed",
  "campaign_send.completed",
  "domain.created",
  "domain.updated",
  "contact.updated",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_EVENT_TYPE_SET = new Set<string>(WEBHOOK_EVENT_TYPES);

/** Dual-secret rotation window after rotate (previous remains valid). */
export const WEBHOOK_DUAL_SECRET_WINDOW_MS = 24 * 60 * 60 * 1000;

export const WEBHOOK_HTTP_MAX_ATTEMPTS = 8;
