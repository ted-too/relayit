import { pgEnum } from "drizzle-orm/pg-core";
import * as z from "zod";

/**
 * Channels Relayit can send on. Stored on providers, messages, and user
 * channel governance — this array is the single source of truth for the
 * Postgres enum and for Zod validation.
 */
export const AVAILABLE_CHANNELS = [
  "email",
  // "sms",
  // "whatsapp",
  // "discord",
] as const;

export const zChannels = z.enum(AVAILABLE_CHANNELS);

export const ChannelTypeEnum = zChannels.enum;

export type ChannelType = (typeof AVAILABLE_CHANNELS)[number];

/** Message Purpose — implied by which API created the Message / Campaign Send. */
export const AVAILABLE_MESSAGE_PURPOSES = [
  "transactional",
  "marketing",
] as const;

export type MessagePurpose = (typeof AVAILABLE_MESSAGE_PURPOSES)[number];

/** Provider metering kind — managed platform vs customer-connected (BYO). */
export const AVAILABLE_PROVIDER_KINDS = ["managed", "byo"] as const;

export type ProviderKind = (typeof AVAILABLE_PROVIDER_KINDS)[number];

/** Per-bucket send caps (Purpose × Provider kind) within a Channel. */
export interface BucketSendLimits {
  dailySends: number | null;
  monthlySends: number | null;
}

export interface PurposeProviderLimits {
  byo: BucketSendLimits;
  managed: BucketSendLimits;
}

export interface EmailLimits {
  /** Cloud: whether the Billing User’s Plan may add Project-owned BYO Providers. */
  byoProviders: boolean;
  customDomains: number | null;
  marketing: PurposeProviderLimits;
  transactional: PurposeProviderLimits;
}

export interface ChannelLimits {
  email: EmailLimits;
}

export type ChannelLimit<T extends ChannelType = ChannelType> = Pick<
  ChannelLimits,
  T
>[T];

/** Full plan envelope: org/retention caps plus per-channel limits. */
export interface UserLimits extends ChannelLimits {
  projects: number | null;
  retention: number | null;
}

/**
 * The channel that a provider integration or message is sent through.
 */
export const channelEnum = pgEnum("channel", AVAILABLE_CHANNELS);

/** Delivery status — pipeline position for a Delivery (see Messages CONTEXT). */
export const AVAILABLE_DELIVERY_STATUSES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "skipped",
  "canceled",
] as const;

export type DeliveryStatus = (typeof AVAILABLE_DELIVERY_STATUSES)[number];

export const deliveryStatusEnum = pgEnum(
  "delivery_status",
  AVAILABLE_DELIVERY_STATUSES
);

/** Structured failure payload on a Delivery `error` jsonb column. */
export interface DeliveryError {
  details?: unknown;
  message: string;
  retryable?: boolean;
}

export const messagePurposeEnum = pgEnum(
  "message_purpose",
  AVAILABLE_MESSAGE_PURPOSES
);
