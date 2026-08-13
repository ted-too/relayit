import { pgEnum } from "drizzle-orm/pg-core";
import * as z from "zod";

export const AVAILABLE_CHANNELS = ["email"] as const;

export const zChannels = z.enum(AVAILABLE_CHANNELS);
export const ChannelTypeEnum = zChannels.enum;
export type ChannelType = (typeof AVAILABLE_CHANNELS)[number];

export const AVAILABLE_MESSAGE_PURPOSES = [
  "transactional",
  "marketing",
] as const;
export type MessagePurpose = (typeof AVAILABLE_MESSAGE_PURPOSES)[number];

export const AVAILABLE_PROVIDER_KINDS = ["managed", "byo"] as const;
export type ProviderKind = (typeof AVAILABLE_PROVIDER_KINDS)[number];

export interface BucketSendLimits {
  dailySends: number | null;
  monthlySends: number | null;
}

export interface PurposeProviderLimits {
  byo: BucketSendLimits;
  managed: BucketSendLimits;
}

export interface EmailLimits {
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

export interface UserLimits extends ChannelLimits {
  projects: number | null;
  retention: number | null;
}

/**
 * The channel that a provider integration or message is sent through.
 */
export const channelEnum = pgEnum("channel", AVAILABLE_CHANNELS);

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

export interface DeliveryError {
  details?: unknown;
  message: string;
  retryable?: boolean;
}

export const messagePurposeEnum = pgEnum(
  "message_purpose",
  AVAILABLE_MESSAGE_PURPOSES
);
