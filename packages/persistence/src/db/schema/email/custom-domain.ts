import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "../auth";
import { domainPausedReasonEnum, domainVerificationStatusEnum } from "./domain";

/** DNS host where the domain's records are managed (detected from NS records). */
export const DOMAIN_PROVIDERS = [
  "cloudflare",
  "route53",
  "google",
  "azure",
  "vercel",
  "dnsimple",
  "netlify",
  "ns1",
  "digitalocean",
  "godaddy",
  "namecheap",
  "hover",
  "porkbun",
  "dreamhost",
  "ionos",
  "ovh",
  "gandi",
  "dynadot",
  "namecom",
  "wix",
  "squarespace",
  "shopify",
  "bluehost",
  "hostgator",
  "unknown",
] as const;

export type DomainProvider = (typeof DOMAIN_PROVIDERS)[number];

/**
 * A user's own sending domain (e.g. `acme.com`).
 *
 * Owns the shared BYODKIM keypair and rollup verification state. One row per
 * fqdn; projects attach via `organizationDomain`. Provider registrations live
 * in `emailDomainProviderIdentity`.
 */
export const customDomain = pgTable(
  "custom_domain",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("domn").toString()),
    fqdn: text("fqdn").notNull(),
    dkimSelector: text("dkim_selector").notNull(),
    dkimPublicKey: text("dkim_public_key").notNull(),
    dkimPrivateKey: text("dkim_private_key").notNull(),
    verificationStatus: domainVerificationStatusEnum("verification_status")
      .notNull()
      .default("not_verified"),
    provider: text("provider")
      .$type<DomainProvider>()
      .notNull()
      .default("unknown"),
    isPaused: boolean("is_paused").default(false).notNull(),
    pausedReason: domainPausedReasonEnum("paused_reason"),
    lastCheckedAt: timestamp("last_checked_at"),
    nextVerifyAt: timestamp("next_verify_at"),
    verifyBackoffLevel: integer("verify_backoff_level").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("custom_domain_fqdn_unique_idx").on(t.fqdn),
    index("custom_domain_fqdn_idx").on(t.fqdn),
    index("custom_domain_status_idx").on(t.verificationStatus),
    index("custom_domain_next_verify_at_idx").on(t.nextVerifyAt),
  ]
);

export type CustomDomain = typeof customDomain.$inferSelect;
export type CustomDomainInsert = typeof customDomain.$inferInsert;

export const domainOwnershipVerificationStatusEnum = pgEnum(
  "domain_ownership_verification_status",
  ["not_verified", "verified"]
);

export type DomainOwnershipVerificationStatus =
  (typeof domainOwnershipVerificationStatusEnum.enumValues)[number];

/**
 * Many-to-many link between projects (`organization`) and a `customDomain`,
 * carrying that project's per-domain ownership proof.
 */
export const organizationDomain = pgTable(
  "organization_domain",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customDomainId: text("custom_domain_id")
      .notNull()
      .references(() => customDomain.id, { onDelete: "cascade" }),
    ownershipVerificationStatus: domainOwnershipVerificationStatusEnum(
      "ownership_verification_status"
    )
      .notNull()
      .default("not_verified"),
    ownershipToken: text("ownership_token").notNull(),
    /**
     * Set while this link is a pending claim: Provider the destination chose
     * at create. On successful ownership verify, keep that pairing (and DNS if
     * it matches the source’s managed backend) and tear down other pairings.
     */
    pendingProviderId: text("pending_provider_id"),
    ownershipLastCheckedAt: timestamp("ownership_last_checked_at"),
    ownershipEverVerifiedAt: timestamp("ownership_ever_verified_at"),
    ownershipNextVerifyAt: timestamp("ownership_next_verify_at"),
    ownershipBackoffLevel: integer("ownership_backoff_level")
      .default(0)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.customDomainId] }),
    uniqueIndex("organization_domain_ownership_token_unique_idx").on(
      t.ownershipToken
    ),
    index("organization_domain_organization_idx").on(t.organizationId),
    index("organization_domain_custom_domain_idx").on(t.customDomainId),
    index("organization_domain_ownership_next_verify_at_idx").on(
      t.ownershipNextVerifyAt
    ),
  ]
);

export type OrganizationDomain = typeof organizationDomain.$inferSelect;
export type OrganizationDomainInsert = typeof organizationDomain.$inferInsert;
