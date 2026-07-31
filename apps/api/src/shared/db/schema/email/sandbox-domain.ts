import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "../auth";
import { emailDnsRecord } from "./dns-record";
import { domainPausedReasonEnum, domainVerificationStatusEnum } from "./domain";
import { emailDomainProviderIdentity } from "./provider-identity";

/**
 * A platform-owned shared sandbox root domain (e.g. `relayit.fyi`).
 *
 * Owns the shared BYODKIM keypair; orgs send from a fixed platform local part
 * at this root (see `SANDBOX_FROM_LOCAL_PART`). Provider registrations live in
 * `emailDomainProviderIdentity`.
 */
export const sandboxDomain = pgTable(
  "sandbox_domain",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sbxd").toString()),
    rootDomain: text("root_domain").notNull(),
    dkimSelector: text("dkim_selector").notNull(),
    dkimPublicKey: text("dkim_public_key").notNull(),
    dkimPrivateKey: text("dkim_private_key").notNull(),
    cloudflareZoneId: text("cloudflare_zone_id").notNull(),
    verificationStatus: domainVerificationStatusEnum("verification_status")
      .notNull()
      .default("not_verified"),
    isActive: boolean("is_active").notNull().default(false),
    isPaused: boolean("is_paused").notNull().default(false),
    pausedReason: domainPausedReasonEnum("paused_reason"),
    lastCheckedAt: timestamp("last_checked_at"),
    nextVerifyAt: timestamp("next_verify_at"),
    verifyBackoffLevel: integer("verify_backoff_level").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sandbox_domain_root_domain_unique_idx").on(t.rootDomain),
    index("sandbox_domain_status_idx").on(t.verificationStatus),
    index("sandbox_domain_next_verify_at_idx").on(t.nextVerifyAt),
  ]
);

export type SandboxDomain = typeof sandboxDomain.$inferSelect;
export type SandboxDomainInsert = typeof sandboxDomain.$inferInsert;

export const sandboxDomainRelations = relations(sandboxDomain, ({ many }) => ({
  dnsRecords: many(emailDnsRecord),
  organizations: many(organization),
  providerIdentities: many(emailDomainProviderIdentity),
}));
