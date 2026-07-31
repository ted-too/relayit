import type { ContactProperties } from "@repo/api/validators";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import * as z from "zod";
import { organization, organizationAppEnvironment } from "./auth";
import type { ChannelType } from "./channels";

export type ContactIdentifier<T extends ChannelType> = T extends "email"
  ? {
      email: string;
    }
  : never;

export const AVAILABLE_CONTACT_SUPPRESSION_REASONS = [
  "hard_bounce",
  "complaint",
  "manual",
] as const;

export const zContactSuppressionReason = z.enum(
  AVAILABLE_CONTACT_SUPPRESSION_REASONS
);

export type ContactSuppressionReason =
  (typeof AVAILABLE_CONTACT_SUPPRESSION_REASONS)[number];

export const contactSuppressionReasonEnum = pgEnum(
  "contact_suppression_reason",
  AVAILABLE_CONTACT_SUPPRESSION_REASONS
);

export const AVAILABLE_CONTACT_SUPPRESSION_SEVERITIES = [
  "marketing",
  "all",
] as const;

export const zContactSuppressionSeverity = z.enum(
  AVAILABLE_CONTACT_SUPPRESSION_SEVERITIES
);

export type ContactSuppressionSeverity =
  (typeof AVAILABLE_CONTACT_SUPPRESSION_SEVERITIES)[number];

export const contactSuppressionSeverityEnum = pgEnum(
  "contact_suppression_severity",
  AVAILABLE_CONTACT_SUPPRESSION_SEVERITIES
);

/**
 * A unified recipient profile, scoped to exactly one app environment within a
 * project. Soft-deleted via `deletedAt` so Suppression / Unsubscribe survive.
 */
export const contact = pgTable(
  "contact",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cont").toString()),
    organizationAppEnvironmentId: text("organization_app_environment_id")
      .notNull()
      .references(() => organizationAppEnvironment.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    properties: jsonb("properties").$type<ContactProperties>(),
    /** Global marketing opt-out (all Topics). */
    unsubscribed: boolean("unsubscribed").default(false).notNull(),
    suppressionReason: contactSuppressionReasonEnum("suppression_reason"),
    suppressionSeverity: contactSuppressionSeverityEnum("suppression_severity"),
    suppressedAt: timestamp("suppressed_at"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("contact_organization_app_environment_idx").on(
      t.organizationAppEnvironmentId
    ),
    uniqueIndex("contact_app_env_email_unique_idx").on(
      t.organizationAppEnvironmentId,
      t.email
    ),
    index("contact_email_idx").on(t.email),
    index("contact_properties_gin_idx").using("gin", t.properties),
    index("contact_unsubscribed_idx").on(t.unsubscribed),
    index("contact_suppression_reason_idx").on(t.suppressionReason),
    index("contact_suppression_severity_idx").on(t.suppressionSeverity),
    index("contact_deleted_at_idx").on(t.deletedAt),
  ]
);

/** Project-scoped marketing consent category. */
export const topic = pgTable(
  "topic",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("topc").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("topic_organization_idx").on(t.organizationId),
    uniqueIndex("topic_organization_name_uidx").on(t.organizationId, t.name),
  ]
);

/** Project-scoped Campaign Send targeting set (static membership). */
export const segment = pgTable(
  "segment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("segm").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("segment_organization_idx").on(t.organizationId),
    uniqueIndex("segment_organization_name_uidx").on(t.organizationId, t.name),
  ]
);

export const segmentMember = pgTable(
  "segment_member",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sgmb").toString()),
    segmentId: text("segment_id")
      .notNull()
      .references(() => segment.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("segment_member_segment_contact_uidx").on(
      t.segmentId,
      t.contactId
    ),
    index("segment_member_contact_idx").on(t.contactId),
  ]
);

/** Per-Topic marketing opt-out for a Contact. */
export const contactTopicUnsubscribe = pgTable(
  "contact_topic_unsubscribe",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ctun").toString()),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("contact_topic_unsubscribe_uidx").on(t.contactId, t.topicId),
    index("contact_topic_unsubscribe_topic_idx").on(t.topicId),
  ]
);

export const contactRelations = relations(contact, ({ one, many }) => ({
  appEnvironment: one(organizationAppEnvironment, {
    fields: [contact.organizationAppEnvironmentId],
    references: [organizationAppEnvironment.id],
  }),
  segmentMemberships: many(segmentMember),
  topicUnsubscribes: many(contactTopicUnsubscribe),
}));

export const topicRelations = relations(topic, ({ one, many }) => ({
  organization: one(organization, {
    fields: [topic.organizationId],
    references: [organization.id],
  }),
  contactUnsubscribes: many(contactTopicUnsubscribe),
}));

export const segmentRelations = relations(segment, ({ one, many }) => ({
  organization: one(organization, {
    fields: [segment.organizationId],
    references: [organization.id],
  }),
  members: many(segmentMember),
}));

export const segmentMemberRelations = relations(segmentMember, ({ one }) => ({
  segment: one(segment, {
    fields: [segmentMember.segmentId],
    references: [segment.id],
  }),
  contact: one(contact, {
    fields: [segmentMember.contactId],
    references: [contact.id],
  }),
}));

export const contactTopicUnsubscribeRelations = relations(
  contactTopicUnsubscribe,
  ({ one }) => ({
    contact: one(contact, {
      fields: [contactTopicUnsubscribe.contactId],
      references: [contact.id],
    }),
    topic: one(topic, {
      fields: [contactTopicUnsubscribe.topicId],
      references: [topic.id],
    }),
  })
);
