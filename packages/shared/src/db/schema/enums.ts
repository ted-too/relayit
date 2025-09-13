import {
  AVAILABLE_ACTION_TYPES,
  AVAILABLE_CHANNELS,
  AVAILABLE_EVENT_SOURCES,
  AVAILABLE_MESSAGE_SOURCES,
  AVAILABLE_MESSAGE_STATUSES,
  AVAILABLE_PROVIDER_TYPES,
  AVAILABLE_SUBSCRIPTION_STATUSES,
  AVAILABLE_TEMPLATE_CATEGORIES,
  AVAILABLE_TEMPLATE_STATUSES,
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
export const messageStatusEnum = pgEnum(
  "message_status",
  AVAILABLE_MESSAGE_STATUSES
);

/**
 * Subscription status enum - reusable across all marketing channels
 * Used for email, SMS, push notification subscription management
 */
export const subscriptionStatusEnum = pgEnum(
  "subscription_status",
  AVAILABLE_SUBSCRIPTION_STATUSES
);

/**
 * Template status enum - defines template lifecycle states
 */
export const templateStatusEnum = pgEnum(
  "template_status",
  AVAILABLE_TEMPLATE_STATUSES
);

/**
 * Template category enum - classifies templates by use case
 */
export const templateCategoryEnum = pgEnum(
  "template_category",
  AVAILABLE_TEMPLATE_CATEGORIES
);

/**
 * Message source enum - defines how messages were created
 */
export const messageSourceEnum = pgEnum(
  "message_source",
  AVAILABLE_MESSAGE_SOURCES
);

/**
 * Event source enum - defines how events were triggered
 */
export const eventSourceEnum = pgEnum("event_source", AVAILABLE_EVENT_SOURCES);

/**
 * Action type enum - defines the types of actions that can be executed
 * Extensible system for different action types
 */
export const actionTypeEnum = pgEnum("action_type", AVAILABLE_ACTION_TYPES);

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
