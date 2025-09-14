import { AWS_PROVIDER_CONFIG } from "./aws";

export const PROVIDER_CONFIG = {
  aws: AWS_PROVIDER_CONFIG,
} as const;

export type ProviderType = keyof typeof PROVIDER_CONFIG;
export const AVAILABLE_PROVIDER_TYPES = Object.keys(PROVIDER_CONFIG) as [
  ProviderType,
  ...ProviderType[],
];

// Message status types
export const AVAILABLE_MESSAGE_STATUSES = [
  "queued",
  "processing",
  "sent",
  "failed",
  "delivered",
  "malformed",
] as const;

export type MessageStatus = (typeof AVAILABLE_MESSAGE_STATUSES)[number];

// Subscription status types
export const AVAILABLE_SUBSCRIPTION_STATUSES = [
  "opted_out",
  "subscribed",
  "unsubscribed",
  // "bounced",
  // "complained",
] as const;

export type SubscriptionStatus =
  (typeof AVAILABLE_SUBSCRIPTION_STATUSES)[number];

// Template status types
export const AVAILABLE_TEMPLATE_STATUSES = [
  "draft",
  "active",
  "archived",
] as const;

export type TemplateStatus = (typeof AVAILABLE_TEMPLATE_STATUSES)[number];

// Template category types
export const AVAILABLE_TEMPLATE_CATEGORIES = [
  "transactional",
  // "marketing",
  // "system",
  // "notification",
] as const;

export type TemplateCategory = (typeof AVAILABLE_TEMPLATE_CATEGORIES)[number];

// Message source types
export const AVAILABLE_MESSAGE_SOURCES = [
  "api",
  "template",
  // "event", // TODO: Add back once events are implemented
  // "manual",
] as const;

export type MessageSource = (typeof AVAILABLE_MESSAGE_SOURCES)[number];

// Event source types
export const AVAILABLE_EVENT_SOURCES = [
  "api",
  // "webhook",
  // "manual",
] as const;

export type EventSource = (typeof AVAILABLE_EVENT_SOURCES)[number];

// Action type types
export const AVAILABLE_ACTION_TYPES = [
  "send_message",
  // "send_webhook", // Commented out for future use
] as const;

export type ActionType = (typeof AVAILABLE_ACTION_TYPES)[number];

export {
  AVAILABLE_CHANNELS,
  type ChannelType,
  type GenericProviderConfig,
  type GenericProviderCredentials,
} from "./base";
export * from "./send";
export * from "./zod-helpers";
