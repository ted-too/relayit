// TODO: Look at actual product and determine if we need this
// import { type InferSelectModel, relations } from "drizzle-orm";
// import {
//   boolean,
//   index,
//   integer,
//   jsonb,
//   pgTable,
//   text,
//   timestamp,
//   uniqueIndex,
// } from "drizzle-orm/pg-core";
// import { typeid } from "typeid-js";
// import { app } from "./app";
// import { organization } from "./auth";
// import { actionTypeEnum, eventSourceEnum, executionStatusEnum } from "./enums";

// const EVENT_TRIGGER_TYPES = [
//   "api",
//   // "webhook",
//   // "manual",
//   // "scheduled"
// ] as const;
// type EventTriggerType = (typeof EVENT_TRIGGER_TYPES)[number];

// // Organization-scoped, channel-specific event configuration
// export const eventConfig = pgTable(
//   "event_config",
//   {
//     id: text("id")
//       .primaryKey()
//       .$defaultFn(() => typeid("evnt").toString()),
//     organizationId: text("organization_id")
//       .notNull()
//       .references(() => organization.id, { onDelete: "cascade" }),

//     name: text("name").notNull(),
//     slug: text("slug").notNull(),

//     triggerTypes: jsonb("trigger_types")
//       .$type<EventTriggerType[]>()
//       .default(["api"]),

//     schema: jsonb("schema"),
//     isActive: boolean("is_active").default(true),
//     createdAt: timestamp("created_at").defaultNow().notNull(),
//     updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
//   },
//   (t) => [
//     uniqueIndex("event_org_slug_unique_idx").on(t.organizationId, t.slug),
//     index("event_organization_idx").on(t.organizationId),
//     index("event_is_active_idx").on(t.isActive),
//   ]
// );

// export type Event = InferSelectModel<typeof eventConfig>;

// /**
//  * Defines relationships for the event table
//  */
// export const eventRelations = relations(eventConfig, ({ one, many }) => ({
//   organization: one(organization, {
//     fields: [eventConfig.organizationId],
//     references: [organization.id],
//   }),
//   actions: many(action),
//   triggers: many(eventTrigger),
// }));

// /**
//  * Extensible action system - defines what happens when events are triggered.
//  * Supports multiple action types (send_message, send_webhook, etc.)
//  */
// export const action = pgTable(
//   "action",
//   {
//     id: text("id")
//       .primaryKey()
//       .$defaultFn(() => typeid("actn").toString()),
//     eventId: text("event_id")
//       .notNull()
//       .references(() => eventConfig.id, { onDelete: "cascade" }),
//     appId: text("app_id")
//       .notNull()
//       .references(() => app.id, { onDelete: "cascade" }),

//     name: text("name").notNull(),

//     // Extensible action type system
//     actionType: actionTypeEnum("action_type").notNull(),

//     // Flexible configuration based on action type
//     config: jsonb("config").$type<any>().notNull(),

//     // Execution settings
//     delaySeconds: integer("delay_seconds").default(0),
//     priority: integer("priority").default(100),
//     isActive: boolean("is_active").default(true),

//     createdAt: timestamp("created_at").defaultNow().notNull(),
//     updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
//     createdBy: text("created_by"), // User ID who created the action
//   },
//   (t) => [
//     index("action_event_idx").on(t.eventId),
//     index("action_app_idx").on(t.appId),
//     index("action_type_idx").on(t.actionType),
//     index("action_priority_idx").on(t.priority),
//     index("action_is_active_idx").on(t.isActive),
//   ]
// );

// export type Action = InferSelectModel<typeof action>;

// export const actionRelations = relations(action, ({ one, many }) => ({
//   event: one(eventConfig, {
//     fields: [action.eventId],
//     references: [eventConfig.id],
//   }),
//   app: one(app, {
//     fields: [action.appId],
//     references: [app.id],
//   }),
//   executions: many(actionExecution),
// }));

// // Event ingestion with pre-resolved contact (handled by API)
// export const eventTrigger = pgTable(
//   "event_trigger",
//   {
//     id: text("id")
//       .primaryKey()
//       .$defaultFn(() => typeid("etrg").toString()),
//     eventId: text("event_id")
//       .notNull()
//       .references(() => eventConfig.id, { onDelete: "cascade" }),

//     // Pre-resolved contact (handled by API)
//     contactId: text("contact_id").notNull(), // References contact.id

//     // Optional from identity (if provided in trigger)
//     fromIdentityId: text("from_identity_id"), // References providerIdentity.id

//     // Trigger source information
//     source: eventSourceEnum("source").notNull(),

//     // Full event payload received (including to, external_identifiers, data)
//     payload: jsonb("payload")
//       .$type<{
//         to: string;
//         external_identifiers?: Record<string, string>;
//         data?: Record<string, any>;
//         from?: string;
//       }>()
//       .notNull(),

//     status: executionStatusEnum().default("processing").notNull(),
//     errorMessage: text("error_message"),
//     actionsTriggered: integer("actions_triggered").default(0),
//     actionsCompleted: integer("actions_completed").default(0),
//     actionsFailed: integer("actions_failed").default(0),

//     triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
//     completedAt: timestamp("completed_at"),
//   },
//   (t) => [
//     index("event_trigger_event_idx").on(t.eventId),
//     index("event_trigger_contact_idx").on(t.contactId),
//     index("event_trigger_from_identity_idx").on(t.fromIdentityId),
//     index("event_trigger_source_idx").on(t.source),
//     index("event_trigger_status_idx").on(t.status),
//     index("event_trigger_triggered_at_idx").on(t.triggeredAt),
//   ]
// );

// export type EventTrigger = InferSelectModel<typeof eventTrigger>;

// /**
//  * Defines relationships for event triggers
//  */
// export const eventTriggerRelations = relations(
//   eventTrigger,
//   ({ one, many }) => ({
//     event: one(eventConfig, {
//       fields: [eventTrigger.eventId],
//       references: [eventConfig.id],
//     }),
//     actionExecutions: many(actionExecution),
//   })
// );

// /**
//  * Simplified action execution tracking.
//  * Records individual action executions within an event trigger.
//  */
// export const actionExecution = pgTable(
//   "action_execution",
//   {
//     id: text("id")
//       .primaryKey()
//       .$defaultFn(() => typeid("aexc").toString()),
//     eventTriggerId: text("event_trigger_id")
//       .notNull()
//       .references(() => eventTrigger.id, { onDelete: "cascade" }),
//     actionId: text("action_id")
//       .notNull()
//       .references(() => action.id, { onDelete: "cascade" }),

//     status: executionStatusEnum("status").default("pending"),
//     errorMessage: text("error_message"),
//     scheduledFor: timestamp("scheduled_for").notNull(),
//     startedAt: timestamp("started_at"),
//     completedAt: timestamp("completed_at"),
//     messageId: text("message_id"),
//     retryCount: integer("retry_count").default(0),
//     maxRetries: integer("max_retries").default(3),
//     nextRetryAt: timestamp("next_retry_at"),
//   },
//   (t) => [
//     index("action_execution_event_trigger_idx").on(t.eventTriggerId),
//     index("action_execution_action_idx").on(t.actionId),
//     index("action_execution_status_idx").on(t.status),
//     index("action_execution_scheduled_for_idx").on(t.scheduledFor),
//     index("action_execution_message_idx").on(t.messageId),
//     index("action_execution_next_retry_idx").on(t.nextRetryAt),
//   ]
// );

// export type ActionExecution = InferSelectModel<typeof actionExecution>;

// /**
//  * Defines relationships for action executions
//  */
// export const actionExecutionRelations = relations(
//   actionExecution,
//   ({ one }) => ({
//     eventTrigger: one(eventTrigger, {
//       fields: [actionExecution.eventTriggerId],
//       references: [eventTrigger.id],
//     }),
//     action: one(action, {
//       fields: [actionExecution.actionId],
//       references: [action.id],
//     }),
//   })
// );
