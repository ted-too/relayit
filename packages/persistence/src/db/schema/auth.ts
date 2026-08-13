import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { type ChannelLimit, channelEnum } from "./channels";
import { sandboxDomain } from "./email/sandbox-domain";

/**
 * Auth & tenancy tables. Most of these (`user`, `account`, `subscription`,
 * `organization`, `member`, `invitation`, `apikey`) are created and migrated by
 * better-auth's schema generator — edit their shape there, not here. Sessions are
 * not a table; they live in Redis secondary storage.
 *
 * The app-owned additions are `userChannel` (per-user channel governance),
 * `organizationAppEnvironment` (project sub-scoping), and the
 * `organization.sandboxDomainId` / `organization.billingUserId` columns we
 * manage ourselves.
 */
export const user = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("user").toString()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
  normalizedEmail: text("normalized_email").unique(),
  // Plan-derived caps synced from the user's subscription by `ensureUserLimits`.
  // Both are billing-user-scoped: max organizations they may own and the data
  // retention window (days) applied across those organizations.
  limitOrganizations: integer("limit_organizations"),
  limitRetention: integer("limit_retention"),
});

export const userChannelPausedReasonEnum = pgEnum(
  "user_channel_paused_reason",
  ["abuse_detected", "manual_admin_pause"]
);

/**
 * Per-(billing user, channel) sending governance — the single source of truth
 * for a user's channel-level limits and pause state across *all* the projects
 * they own.
 *
 * `limits` holds the **actual** effective per-bucket caps read at send time
 * (Purpose × Provider kind; a null means unlimited). They're synced onto this
 * row from the user's plan (cloud) or OSS defaults whenever the subscription
 * changes, so the send path never has to resolve a plan. Quota itself is
 * computed dynamically on the send endpoint against these limits (Redis
 * counters keyed by `(userId, channel, purpose, providerKind, period)`), which
 * is why quota exhaustion is *not* a pause reason here.
 *
 * `isPaused` pauses every project's sending on this channel for this user
 * (channel-scoped abuse, manual admin hold). It sits between the
 * account-wide `user.banned` and the per-domain `customDomain.isPaused`.
 */
export const userChannel = pgTable(
  "user_channel",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channelType: channelEnum("channel_type").notNull(),
    isPaused: boolean("is_paused").default(false).notNull(),
    pausedReason: userChannelPausedReasonEnum("paused_reason"),
    pausedAt: timestamp("paused_at"),
    limits: jsonb("limits").$type<ChannelLimit>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelType] }),
    index("user_channel_user_idx").on(t.userId),
  ]
);

/** Linked external/credential accounts (OAuth providers, password). */
export const account = pgTable(
  "account",
  {
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
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

/**
 * Stripe-backed plan state, managed by the better-auth stripe plugin.
 * `referenceId` points at the owning entity (a user or organization id) and is
 * how the send path resolves the active plan, hence the index.
 */
export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").default("incomplete").notNull(),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    trialStart: timestamp("trial_start"),
    trialEnd: timestamp("trial_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
    cancelAt: timestamp("cancel_at"),
    canceledAt: timestamp("canceled_at"),
    endedAt: timestamp("ended_at"),
    seats: integer("seats"),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
  },
  (t) => [index("subscription_reference_id_idx").on(t.referenceId)]
);

/**
 * An organization — surfaced in the product as a "project" and the primary
 * tenant boundary that contacts, domains, and messages hang off.
 */
export const organization = pgTable(
  "organization",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("orgn").toString()),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    metadata: text("metadata"),
    // The shared sandbox root domain this org is allocated to. Nullable: an org
    // may have no sandbox sender (no active root available). better-auth ignores
    // this column; we set it ourselves after org creation.
    sandboxDomainId: text("sandbox_domain_id").references(
      () => sandboxDomain.id,
      { onDelete: "set null" }
    ),
    // User whose Plan/Usage buckets this Project draws from. Defaults to the
    // Owner on create; may be reassigned. Null means "resolve to Owner".
    billingUserId: text("billing_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("organization_slug_uidx").on(table.slug),
    index("organization_sandbox_domain_idx").on(table.sandboxDomainId),
    index("organization_billing_user_idx").on(table.billingUserId),
  ]
);

/**
 * A project-scoped app/environment pair used to partition contacts and messages.
 *
 * `app` and `environment` are nullable — when omitted from API requests the send
 * path resolves (or creates) the org's default row where both are null.
 */
export const organizationAppEnvironment = pgTable(
  "organization_app_environment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("oenv").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    app: text("app"),
    environment: text("environment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("organization_app_environment_organization_idx").on(t.organizationId),
    uniqueIndex("organization_app_environment_org_app_env_unique_idx").on(
      t.organizationId,
      sql`coalesce(${t.app}, '')`,
      sql`coalesce(${t.environment}, '')`
    ),
  ]
);

/** Join row placing a user in an organization with a role. */
export const member = pgTable(
  "member",
  {
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
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ]
);

/** Pending invitation for an email address to join an organization. */
export const invitation = pgTable(
  "invitation",
  {
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
    createdAt: timestamp("created_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
);

/** API keys for programmatic access; `referenceId` is the owning org/user. */
export const apikey = pgTable(
  "apikey",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("akey").toString()),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
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
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ]
);
