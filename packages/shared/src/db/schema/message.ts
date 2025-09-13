import { type InferEnum, type InferSelectModel, relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { apikey } from "./auth";
import { contact } from "./contact";
import { bytea } from "./custom-types";
import { channelEnum, messageSourceEnum, messageStatusEnum } from "./enums";
import { providerIdentity } from "./provider";

export type MessageStatus = InferEnum<typeof messageStatusEnum>;

// Primitive message data with final provider tracking
export const message = pgTable(
  "message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("mesg").toString()),
    appSlug: text("app_slug"),
    apiKeyId: text("api_key_id").references(() => apikey.id, {
      onDelete: "set null",
    }),

    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),

    // Final successful identity (nullable until success)
    fromIdentityId: text("from_identity_id").references(
      () => providerIdentity.id,
      { onDelete: "set null" }
    ),

    payload: bytea("payload"), // Raw binary data
    source: messageSourceEnum("source").default("api").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("message_api_key_idx").on(t.apiKeyId),
    index("message_contact_idx").on(t.contactId),
    index("message_channel_idx").on(t.channel),
    index("message_from_identity_idx").on(t.fromIdentityId),
    index("message_source_idx").on(t.source),
    index("message_app_slug_idx").on(t.appSlug),
    index("message_created_at_idx").on(t.createdAt),
  ]
);

export type Message = InferSelectModel<typeof message>;

// Message audit trail + provider health tracking
export const messageEvent = pgTable(
  "message_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("msev").toString()),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),

    status: messageStatusEnum("status").notNull(),
    attemptNumber: integer("attempt_number").notNull(), // 1, 2, 3 for fallbacks
    fromIdentityId: text("from_identity_id").references(
      () => providerIdentity.id,
      { onDelete: "set null" }
    ),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    responseTimeMs: integer("response_time_ms"),
    retryable: boolean("retryable").default(true),
    error: jsonb("error").$type<{
      code?: string;
      message?: string;
      category?: string;
      details?: Record<string, any>;
    }>(),
  },
  (t) => [
    index("message_event_message_idx").on(t.messageId),
    index("message_event_attempt_idx").on(t.messageId, t.attemptNumber),
    index("message_event_status_idx").on(t.status),
    index("message_event_started_at_idx").on(t.startedAt),
    index("message_event_response_time_idx").on(t.responseTimeMs),
  ]
);

// Links messages to template versions with rendering props
export const messageTemplate = pgTable(
  "message_template",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("mtpl").toString()),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    templateVersionId: text("template_version_id").notNull(),
    templateProps: jsonb("template_props")
      .$type<Record<string, any>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("message_template_message_idx").on(t.messageId),
    index("message_template_version_idx").on(t.templateVersionId),
  ]
);

export type MessageTemplate = InferSelectModel<typeof messageTemplate>;

export const messageRelations = relations(message, ({ one, many }) => ({
  apiKey: one(apikey, {
    fields: [message.apiKeyId],
    references: [apikey.id],
  }),
  contact: one(contact, {
    fields: [message.contactId],
    references: [contact.id],
  }),
  fromIdentity: one(providerIdentity, {
    fields: [message.fromIdentityId],
    references: [providerIdentity.id],
  }),
  events: many(messageEvent),
  templates: many(messageTemplate),
}));

export const messageEventRelations = relations(messageEvent, ({ one }) => ({
  message: one(message, {
    fields: [messageEvent.messageId],
    references: [message.id],
  }),
  fromIdentity: one(providerIdentity, {
    fields: [messageEvent.fromIdentityId],
    references: [providerIdentity.id],
  }),
}));

export const messageTemplateRelations = relations(
  messageTemplate,
  ({ one }) => ({
    message: one(message, {
      fields: [messageTemplate.messageId],
      references: [message.id],
    }),
  })
);
