export {
  AVAILABLE_PROVIDER_TYPES,
  PROVIDER_CONFIG,
  type ProviderType,
} from "./config";

// Message status types
export const AVAILABLE_MESSAGE_STATUSES = [
  "queued",
  "processing",
  "sent",
  "failed",
  "delivered",
  "malformed",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "rejected",
  "rendering_failed",
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

export const AVAILABLE_PROVIDER_SCOPES = ["org", "platform"] as const;

export type ProviderScope = (typeof AVAILABLE_PROVIDER_SCOPES)[number];

export const AVAILABLE_DOMAIN_STATUSES = [
  "pending",
  "verifying",
  "verified",
  "failed",
  "paused",
] as const;
export type DomainStatus = (typeof AVAILABLE_DOMAIN_STATUSES)[number];

export const AVAILABLE_DOMAIN_KINDS = ["custom", "sandbox_subdomain"] as const;

export type DomainKind = (typeof AVAILABLE_DOMAIN_KINDS)[number];

export const AVAILABLE_DNS_RECORD_PURPOSES = ["dkim", "spf", "dmarc"] as const;

export type DnsRecordPurpose = (typeof AVAILABLE_DNS_RECORD_PURPOSES)[number];

export const AVAILABLE_DNS_RECORD_TYPES = ["CNAME", "TXT", "MX"] as const;

export type DnsRecordType = (typeof AVAILABLE_DNS_RECORD_TYPES)[number];

export { awsEmailDomainConfigSchema } from "./aws";
export {
  AVAILABLE_CHANNELS,
  type ChannelType,
  type GenericProviderChannelConfig,
  type GenericProviderConfig,
  type GenericProviderCredentials,
} from "./base";
export {
  type DomainProviderData,
  domainProviderDataSchema,
  getDomainConfigSchema,
  type InferChannelDomainConfig,
  parseDomainProviderData,
} from "./domain";
export * from "./send";
export * from "./zod-helpers";
