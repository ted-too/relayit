import type { GenericProviderCredentials } from "@repo/shared/providers";
import { type InferSelectModel, relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "./auth";
import { channelEnum, providerTypeEnum } from "./enums";

// Organization-level provider credentials with fallback priority
export const providerCredential = pgTable(
  "provider_credential",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("prvc").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelType: channelEnum("channel_type").notNull(),
    providerType: providerTypeEnum("provider_type").notNull(),
    name: text("name").notNull(),
    credentials: jsonb("credentials")
      .$type<GenericProviderCredentials>()
      .notNull(),

    isDefault: boolean("is_default").default(false).notNull(),
    priority: integer("priority").default(100).notNull(), // Lower = higher priority
    isActive: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("provider_credential_org_channel_default_unique_idx")
      .on(t.organizationId, t.channelType, t.isDefault)
      .where(sql`${t.isDefault} = true`),
    index("provider_credential_organization_idx").on(t.organizationId),
    index("provider_credential_channel_type_idx").on(t.channelType),
    index("provider_credential_priority_idx").on(t.priority),
    index("provider_credential_active_idx").on(t.isActive),
  ]
);

export type NotificationProvider = InferSelectModel<typeof providerCredential>;

export const providerCredentialRelations = relations(
  providerCredential,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [providerCredential.organizationId],
      references: [organization.id],
    }),
    identities: many(providerIdentity),
  })
);

// Multiple from identities per provider
export const providerIdentity = pgTable(
  "provider_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("prid").toString()),
    providerCredentialId: text("provider_credential_id")
      .notNull()
      .references(() => providerCredential.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    identifier: text("identifier").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One default identity per provider
    uniqueIndex("provider_identity_provider_default_unique_idx")
      .on(t.providerCredentialId, t.isDefault)
      .where(sql`${t.isDefault} = true`),
    uniqueIndex("provider_identity_provider_identifier_unique_idx").on(
      t.providerCredentialId,
      t.identifier
    ),
    index("provider_identity_provider_idx").on(t.providerCredentialId),
    index("provider_identity_identifier_idx").on(t.identifier),
    index("provider_identity_default_idx").on(t.isDefault),
    index("provider_identity_active_idx").on(t.isActive),
  ]
);

export type ProviderIdentity = InferSelectModel<typeof providerIdentity>;

export const providerIdentityRelations = relations(
  providerIdentity,
  ({ one }) => ({
    providerCredential: one(providerCredential, {
      fields: [providerIdentity.providerCredentialId],
      references: [providerCredential.id],
    }),
  })
);
