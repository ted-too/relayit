import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { provider } from "../provider";
import { customDomain } from "./custom-domain";
import { domainVerificationStatusEnum } from "./domain";
import { sandboxDomain } from "./sandbox-domain";

/**
 * A provider's sending identity on a domain (custom or sandbox root).
 *
 * The domain row owns shared material (e.g. BYODKIM) and customer-facing DNS
 * hosts unique per pairing. Exactly one identity is `isActive` (primary send
 * path); others may be `failoverEligible` and are tried in `failoverPriority`
 * order after active on circuit-open / terminal provider errors.
 */
export const emailDomainProviderIdentity = pgTable(
  "email_domain_provider_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("epid").toString()),
    customDomainId: text("custom_domain_id").references(() => customDomain.id, {
      onDelete: "cascade",
    }),
    sandboxDomainId: text("sandbox_domain_id").references(
      () => sandboxDomain.id,
      { onDelete: "cascade" }
    ),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.id, { onDelete: "restrict" }),
    verificationStatus: domainVerificationStatusEnum("verification_status")
      .notNull()
      .default("not_verified"),
    providerData: jsonb("provider_data"),
    /** Primary send path for this Domain / Sandbox Domain. */
    isActive: boolean("is_active").notNull().default(true),
    /**
     * When not active: whether this pairing may receive failover traffic.
     * Additive pairings default true; turning off does not remove the pairing.
     */
    failoverEligible: boolean("failover_eligible").notNull().default(true),
    /**
     * Failover order among non-active eligible pairings (lower = sooner).
     * Newly added pairings append after active by default.
     */
    failoverPriority: integer("failover_priority").notNull().default(100),
    lastCheckedAt: timestamp("last_checked_at"),
    nextVerifyAt: timestamp("next_verify_at"),
    verifyBackoffLevel: integer("verify_backoff_level").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "email_domain_provider_identity_domain_kind_check",
      sql`(${t.customDomainId} IS NOT NULL) <> (${t.sandboxDomainId} IS NOT NULL)`
    ),
    uniqueIndex("email_domain_provider_identity_custom_provider_unique_idx")
      .on(t.customDomainId, t.providerId)
      .where(sql`${t.customDomainId} IS NOT NULL`),
    uniqueIndex("email_domain_provider_identity_sandbox_provider_unique_idx")
      .on(t.sandboxDomainId, t.providerId)
      .where(sql`${t.sandboxDomainId} IS NOT NULL`),
    index("email_domain_provider_identity_custom_domain_idx").on(
      t.customDomainId
    ),
    index("email_domain_provider_identity_sandbox_domain_idx").on(
      t.sandboxDomainId
    ),
    index("email_domain_provider_identity_provider_idx").on(t.providerId),
    index("email_domain_provider_identity_next_verify_at_idx").on(
      t.nextVerifyAt
    ),
  ]
);

export type EmailDomainProviderIdentity =
  typeof emailDomainProviderIdentity.$inferSelect;

export const emailDomainProviderIdentityRelations = relations(
  emailDomainProviderIdentity,
  ({ one }) => ({
    customDomain: one(customDomain, {
      fields: [emailDomainProviderIdentity.customDomainId],
      references: [customDomain.id],
    }),
    sandboxDomain: one(sandboxDomain, {
      fields: [emailDomainProviderIdentity.sandboxDomainId],
      references: [sandboxDomain.id],
    }),
    provider: one(provider, {
      fields: [emailDomainProviderIdentity.providerId],
      references: [provider.id],
    }),
  })
);
