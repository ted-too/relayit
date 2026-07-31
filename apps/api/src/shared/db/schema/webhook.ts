import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "./auth";

/** Outbound HTTP attempt lifecycle for a Webhook Event → Endpoint. */
export const AVAILABLE_WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "held",
  "delivered",
  "dead_letter",
] as const;

export type WebhookDeliveryStatus =
  (typeof AVAILABLE_WEBHOOK_DELIVERY_STATUSES)[number];

export const webhookDeliveryStatusEnum = pgEnum(
  "webhook_delivery_status",
  AVAILABLE_WEBHOOK_DELIVERY_STATUSES
);

/**
 * Project-scoped customer Webhook Endpoint (HMAC-signed outbound POSTs).
 */
export const webhookEndpoint = pgTable(
  "webhook_endpoint",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("whkep").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Opt-in event type allowlist; empty = receive none. */
    eventTypes: jsonb("event_types").$type<string[]>().notNull().default([]),
    /** Optional Message Tag filter (all listed key/value pairs must match). */
    tagFilter: jsonb("tag_filter").$type<Record<string, string>>(),
    enabled: boolean("enabled").notNull().default(true),
    signingSecret: text("signing_secret").notNull(),
    previousSigningSecret: text("previous_signing_secret"),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("webhook_endpoint_organization_idx").on(t.organizationId),
    index("webhook_endpoint_organization_enabled_idx").on(
      t.organizationId,
      t.enabled
    ),
  ]
);

export type WebhookEndpoint = typeof webhookEndpoint.$inferSelect;
export type WebhookEndpointInsert = typeof webhookEndpoint.$inferInsert;

/**
 * Persisted only when ≥1 Endpoint matches (enabled or disabled).
 */
export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("whevt").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** Stable idempotency id for receiver dedupe across retries/replays. */
    idempotencyId: text("idempotency_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("webhook_event_idempotency_uidx").on(t.idempotencyId),
    index("webhook_event_organization_created_idx").on(
      t.organizationId,
      t.createdAt
    ),
    index("webhook_event_type_idx").on(t.type),
  ]
);

export type WebhookEvent = typeof webhookEvent.$inferSelect;
export type WebhookEventInsert = typeof webhookEvent.$inferInsert;

/** Per-Endpoint dispatch row for a Webhook Event. */
export const webhookEventDelivery = pgTable(
  "webhook_event_delivery",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("whdlv").toString()),
    webhookEventId: text("webhook_event_id")
      .notNull()
      .references(() => webhookEvent.id, { onDelete: "cascade" }),
    webhookEndpointId: text("webhook_endpoint_id")
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: "cascade" }),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("webhook_event_delivery_event_endpoint_uidx").on(
      t.webhookEventId,
      t.webhookEndpointId
    ),
    index("webhook_event_delivery_status_next_idx").on(
      t.status,
      t.nextAttemptAt
    ),
    index("webhook_event_delivery_endpoint_idx").on(t.webhookEndpointId),
  ]
);

export type WebhookEventDelivery = typeof webhookEventDelivery.$inferSelect;
export type WebhookEventDeliveryInsert =
  typeof webhookEventDelivery.$inferInsert;

export const webhookEndpointRelations = relations(
  webhookEndpoint,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [webhookEndpoint.organizationId],
      references: [organization.id],
    }),
    deliveries: many(webhookEventDelivery),
  })
);

export const webhookEventRelations = relations(
  webhookEvent,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [webhookEvent.organizationId],
      references: [organization.id],
    }),
    deliveries: many(webhookEventDelivery),
  })
);

export const webhookEventDeliveryRelations = relations(
  webhookEventDelivery,
  ({ one }) => ({
    event: one(webhookEvent, {
      fields: [webhookEventDelivery.webhookEventId],
      references: [webhookEvent.id],
    }),
    endpoint: one(webhookEndpoint, {
      fields: [webhookEventDelivery.webhookEndpointId],
      references: [webhookEndpoint.id],
    }),
  })
);
