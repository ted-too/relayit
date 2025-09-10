import {
  AVAILABLE_CHANNELS,
  AVAILABLE_PROVIDER_TYPES,
} from "@repo/shared/providers";
import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared channel enum - single source of truth for all notification channels
 * Used across providers, templates, events, messages, and analytics
 */
export const channelEnum = pgEnum("channel", AVAILABLE_CHANNELS);

/**
 * Provider type enum - defines the available notification providers
 */
export const providerTypeEnum = pgEnum(
  "provider_type",
  AVAILABLE_PROVIDER_TYPES
);

/**
 * Message status enum - tracks the lifecycle of messages
 */
export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "processing",
  "sent",
  "failed",
  "delivered",
  "malformed",
]);

/**
 * Subscription status enum - reusable across all marketing channels
 * Used for email, SMS, push notification subscription management
 */
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "opted_out",
  "subscribed",
  "unsubscribed",
  // "bounced",
  // "complained",
]);

/**
 * Template status enum - defines template lifecycle states
 */
export const templateStatusEnum = pgEnum("template_status", [
  "draft",
  "active",
  "archived",
]);

/**
 * Template category enum - classifies templates by use case
 */
export const templateCategoryEnum = pgEnum("template_category", [
  "transactional",
  "marketing",
  // "system",
  // "notification",
]);

/**
 * Message source enum - defines how messages were created
 */
export const messageSourceEnum = pgEnum("message_source", [
  "api",
  // "event", // TODO: Add back once events are implemented
  // "manual",
]);

/**
 * Event source enum - defines how events were triggered
 */
export const eventSourceEnum = pgEnum("event_source", [
  "api",
  // "webhook",
  // "manual",
]);

/**
 * Action type enum - defines the types of actions that can be executed
 * Extensible system for different action types
 */
export const actionTypeEnum = pgEnum("action_type", [
  "send_message",
  // "send_webhook", // Commented out for future use
]);

// NOTE: See ./event.ts for execution status enum
/**
 * Execution status enum - reusable for actions, jobs, and async operations
 * Used for action executions, event processing, and background jobs
 */
// export const executionStatusEnum = pgEnum("execution_status", [
//   "pending",
//   "processing",
//   "completed",
//   "failed",
//   "skipped",
// ]);
