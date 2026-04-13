import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { contact } from "./contact";
import { message } from "./message";

/**
 * Represents users in the system.
 */
export const user = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("user").toString()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
  normalizedEmail: text("normalized_email").unique(),
});

/**
 * Defines relationships for the user table.
 * Users can have multiple sessions, accounts, passkeys, API keys, memberships, and invitations.
 */
export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  apikeys: many(apikey),
  memberships: many(member),
  invitationsSent: many(invitation),
}));

/**
 * Represents linked external accounts (e.g., OAuth providers).
 */
export const account = pgTable("account", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("acct").toString()),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

/**
 * Defines relationships for the account table.
 * Each account belongs to one user.
 */
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

/**
 * Stores verification tokens (e.g., email verification, password reset).
 */
export const verification = pgTable("verification", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("vrfy").toString()),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
});

export interface ApiKeyPermissions {
  [key: string]: string[];
}

/**
 * Stores API keys for programmatic access.
 */
export const apikey = pgTable("apikey", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("akey").toString()),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  key: text("key").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window").default(86_400_000),
  rateLimitMax: integer("rate_limit_max").default(10),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

export type ParsedApiKey = Omit<typeof apikey.$inferSelect, "permissions"> & {
  // /**
  //  * Permissions for the api key
  //  */
  // permissions?: ApiKeyPermissions | null;
};

export type ClientParsedApiKey = Omit<ParsedApiKey, "key">;

/**
 * Join table to link API keys with organizations (many-to-many relationship).
 */
export const apikeyOrganization = pgTable("apikey_organization", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("akyo").toString()),
  apikeyId: text("apikey_id")
    .notNull()
    .references(() => apikey.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

/**
 * Defines relationships for the apikeyOrganization join table.
 */
export const apikeyOrganizationRelations = relations(
  apikeyOrganization,
  ({ one }) => ({
    apikey: one(apikey, {
      fields: [apikeyOrganization.apikeyId],
      references: [apikey.id],
    }),
    organization: one(organization, {
      fields: [apikeyOrganization.organizationId],
      references: [organization.id],
    }),
  })
);

/**
 * Defines relationships for the apiKey table.
 * Each API key belongs to one user and can be associated with multiple messages and organizations.
 */
export const apiKeyRelations = relations(apikey, ({ one, many }) => ({
  user: one(user, {
    fields: [apikey.userId],
    references: [user.id],
  }),
  messages: many(message),
  organizations: many(apikeyOrganization),
}));

/**
 * Represents organizations or tenants in the system.
 */
export const organization = pgTable("organization", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("orgn").toString()),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  logo: text("logo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  metadata: text("metadata"),
});

export type Organization = typeof organization.$inferSelect;

/**
 * Defines relationships for the organization table.
 * Organizations can have multiple members, invitations, teams, and API keys.
 */
export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  contacts: many(contact),
  apikeys: many(apikeyOrganization),
}));

/**
 * Represents the membership of a user within an organization, potentially linking them to a team.
 */
export const member = pgTable("member", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("memb").toString()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").default("member").notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export type Member = typeof member.$inferSelect;

/**
 * Defines relationships for the member table.
 * Each membership links one user and one organization, and optionally one team.
 */
export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled";

/**
 * Stores invitations for users to join an organization.
 */
export const invitation = pgTable("invitation", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("invt").toString()),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/**
 * Defines relationships for the invitation table.
 * Each invitation belongs to an organization, is sent by a user (inviter), and may target a team.
 */
export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));
