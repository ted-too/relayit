import { type InferSelectModel, relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "./auth";
import { channelEnum, subscriptionStatusEnum } from "./enums";

// Unified contact profiles with automatic identity resolution
export const contact = pgTable(
  "contact",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cont").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name"),

    // For automatic contact linking: {"user_id": "12345", "customer_id": "cust_789"}
    externalIdentifiers: jsonb("external_identifiers")
      .$type<Record<string, string[]>>()
      .default({}),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => [index("contact_organization_idx").on(t.organizationId)]
);

export type Contact = InferSelectModel<typeof contact>;

export const contactRelations = relations(contact, ({ one, many }) => ({
  organization: one(organization, {
    fields: [contact.organizationId],
    references: [organization.id],
  }),
  identifiers: many(contactIdentifier),
}));

// Channel identifiers with uniqueness enforcement
export const contactIdentifier = pgTable(
  "contact_identifier",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cid").toString()),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),

    channel: channelEnum().notNull(),
    identifier: text("identifier").notNull(),
    isPrimary: boolean("is_primary").default(false),

    marketingStatus:
      subscriptionStatusEnum("marketing_status").default("subscribed"),
    marketingStatusUpdatedAt: timestamp("marketing_status_updated_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => [
    // One primary identifier per contact per channel
    uniqueIndex("contact_identifier_contact_channel_primary_unique_idx")
      .on(t.contactId, t.channel, t.isPrimary)
      .where(sql`${t.isPrimary} = true`),

    // Prevent duplicate identifiers within same channel
    uniqueIndex("contact_identifier_channel_identifier_unique_idx").on(
      t.channel,
      t.identifier
    ),
    index("contact_identifier_contact_idx").on(t.contactId),
    index("contact_identifier_channel_idx").on(t.channel),
    index("contact_identifier_identifier_idx").on(t.identifier),
    index("contact_identifier_primary_idx").on(t.isPrimary),
    index("contact_identifier_marketing_status_idx").on(t.marketingStatus),
  ]
);

export type ContactIdentifier = InferSelectModel<typeof contactIdentifier>;

export const contactIdentifierRelations = relations(
  contactIdentifier,
  ({ one }) => ({
    contact: one(contact, {
      fields: [contactIdentifier.contactId],
      references: [contact.id],
    }),
  })
);
