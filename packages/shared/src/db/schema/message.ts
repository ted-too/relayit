import type { SendRawPayload } from "@repo/shared/providers";
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
import { type Contact, type ContactIdentifier, contact } from "./contact";
import { channelEnum, messageSourceEnum, messageStatusEnum } from "./enums";
import {
  type ProviderCredential,
  type ProviderIdentity,
  providerIdentity,
} from "./provider";

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

    payload: jsonb("payload").$type<SendRawPayload>().notNull(),
    source: messageSourceEnum("source").default("api").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("message_api_key_idx").on(t.apiKeyId),
    index("message_contact_idx").on(t.contactId),
    index("message_channel_idx").on(t.channel),
    index("message_source_idx").on(t.source),
    index("message_app_slug_idx").on(t.appSlug),
    index("message_created_at_idx").on(t.createdAt),
  ]
);

export type Message = InferSelectModel<typeof message>;

export interface MessageEventError {
  code: string;
  message: string;
}

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
    attemptNumber: integer("attempt_number").notNull(), // 1, 2, 3 for retries (resets on provider change)
    identityId: text("identity_id")
      .notNull()
      .references(() => providerIdentity.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    responseTimeMs: integer("response_time_ms"),
    retryable: boolean("retryable").default(true),
    error: jsonb("error").$type<MessageEventError>(),
  },
  (t) => [
    index("message_event_message_idx").on(t.messageId),
    index("message_event_attempt_idx").on(t.messageId, t.attemptNumber),
    index("message_event_status_idx").on(t.status),
    index("message_event_identity_idx").on(t.identityId),
    index("message_event_started_at_idx").on(t.startedAt),
    index("message_event_response_time_idx").on(t.responseTimeMs),
  ]
);

export type MessageEvent = InferSelectModel<typeof messageEvent>;

export interface MessageEventWithRelations extends MessageEvent {
  message: Message & {
    contact: Contact & {
      identifiers: ContactIdentifier[];
    };
  };
  identity: ProviderIdentity & {
    providerCredential: ProviderCredential;
  };
}

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
    templateProps: jsonb("template_props").$type<Record<string, any>>(),
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
  events: many(messageEvent),
  templates: many(messageTemplate),
}));

export const messageEventRelations = relations(messageEvent, ({ one }) => ({
  message: one(message, {
    fields: [messageEvent.messageId],
    references: [message.id],
  }),
  identity: one(providerIdentity, {
    fields: [messageEvent.identityId],
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
