import {
	pgTable,
	text,
	timestamp,
	boolean,
	integer,
	uniqueIndex,
	jsonb,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, relations } from "drizzle-orm";
import { typeid } from "typeid-js";

// Import relations from core schema
import {
	message,
	type ProjectProviderAssociation,
	projectProviderAssociation,
} from "@repo/db/schema/core";
import type { ChannelType, ProviderType } from "@repo/shared";

/**
 * Represents users in the system.
 */
export const user = pgTable("user", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => typeid("user").toString()),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull(),
	image: text("image"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
	normalizedEmail: text("normalized_email").unique(),
});

/**
 * Defines relationships for the user table.
 * Users can have multiple sessions, accounts, passkeys, API keys, memberships, and invitations.
 */
export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
	passkeys: many(passkey),
	apikeys: many(apikey),
	memberships: many(member),
	invitationsSent: many(invitation),
}));

/**
 * Represents active user sessions.
 */
export const session = pgTable("session", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => typeid("sess").toString()),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	activeOrganizationId: text("active_organization_id"),
});

/**
 * Defines relationships for the session table.
 * Each session belongs to one user.
 */
export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
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
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
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
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

/**
 * Stores passkey (WebAuthn) credentials for users.
 */
export const passkey = pgTable("passkey", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => typeid("pass").toString()),
	name: text("name"),
	publicKey: text("public_key").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	credentialID: text("credential_i_d").notNull().unique(),
	counter: integer("counter").notNull(),
	deviceType: text("device_type").notNull(),
	backedUp: boolean("backed_up").notNull(),
	transports: text("transports"),
	createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Defines relationships for the passkey table.
 * Each passkey belongs to one user.
 */
export const passkeyRelations = relations(passkey, ({ one }) => ({
	user: one(user, {
		fields: [passkey.userId],
		references: [user.id],
	}),
}));

/**
 * Stores API keys for programmatic access.
 */
export const apikey = pgTable("api_key", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => typeid("apik").toString()),
	name: text("name"),
	start: text("start"),
	prefix: text("prefix"),
	key: text("key").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	refillInterval: integer("refill_interval"),
	refillAmount: integer("refill_amount"),
	lastRefillAt: timestamp("last_refill_at"),
	enabled: boolean("enabled").default(true).notNull(),
	rateLimitEnabled: boolean("rate_limit_enabled").default(false),
	rateLimitTimeWindow: integer("rate_limit_time_window"),
	rateLimitMax: integer("rate_limit_max"),
	requestCount: integer("request_count").default(0),
	remaining: integer("remaining"),
	lastRequest: timestamp("last_request"),
	expiresAt: timestamp("expires_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
	permissions: text("permissions"),
	metadata: text("metadata"),
});

export type ParsedApiKey = Omit<
	typeof apikey.$inferSelect,
	"permissions" | "metadata"
> & {
	/**
	 * Extra metadata about the apiKey
	 */
	metadata: Record<string, any> | null;
	/**
	 * Permissions for the api key
	 */
	permissions?: {
		[key: string]: string[];
	} | null;
};

/**
 * Defines relationships for the apiKey table.
 * Each API key belongs to one user and can be associated with multiple messages.
 */
export const apiKeyRelations = relations(apikey, ({ one, many }) => ({
	user: one(user, {
		fields: [apikey.userId],
		references: [user.id],
	}),
	messages: many(message),
}));

/**
 * Represents organizations or tenants in the system.
 */
export const organization = pgTable("organization", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => typeid("orgn").toString()),
	name: text("name").notNull(),
	slug: text("slug").unique(),
	logo: text("logo"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
	metadata: text("metadata"),
});

/**
 * Defines relationships for the organization table.
 * Organizations can have multiple members, invitations, and teams.
 */
export const organizationRelations = relations(organization, ({ many }) => ({
	members: many(member),
	invitations: many(invitation),
	projects: many(project),
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
	role: text("role").$type<"owner" | "admin" | "member">().notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
});

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
	status: text("status").$type<InvitationStatus>().notNull(),
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

type ProjectMetadata = Record<string, any>;

/**
 * Represents projects within an organization.
 */
export const project = pgTable(
	"project",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => typeid("proj").toString()),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
		metadata: jsonb("metadata").$type<ProjectMetadata>(),
	},
	(t) => [uniqueIndex("slug_idx").on(t.slug, t.organizationId)],
);

export type Project = InferSelectModel<typeof project> & {
	providerAssociations: Pick<ProjectProviderAssociation, "id">[];
};

export type ProjectDetails = Omit<Project, "providerAssociations"> & {
	providerAssociations: (ProjectProviderAssociation & {
		providerCredential: {
			channelType: ChannelType;
			providerType: ProviderType;
		};
	})[];
};

/**
 * Defines relationships for the project table.
 * Each project belongs to one organization.
 */
export const projectRelations = relations(project, ({ one, many }) => ({
	organization: one(organization, {
		fields: [project.organizationId],
		references: [organization.id],
	}),
	providerAssociations: many(projectProviderAssociation),
}));
