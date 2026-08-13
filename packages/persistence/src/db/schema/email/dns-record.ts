import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { customDomain } from "./custom-domain";
import { dnsRecordPurposeEnum, dnsRecordTypeEnum } from "./domain";
import { sandboxDomain } from "./sandbox-domain";

/**
 * What a DNS record does within a sending identity's setup:
 *   - `direct`: the authoritative record proving the sender. Customer-published
 *     for a `customDomain` (no Cloudflare ids — they own the zone) or
 *     platform-published for a `sandboxDomain` root (Cloudflare ids set). This
 *     is the record the live-DNS verification loop polls.
 *   - `proxy`: a branded DKIM host we publish in our own zone that a customer's
 *     `direct` CNAME points at, so the customer only ever pastes one record.
 *   - `shared`: a platform-wide aggregate (e.g. the `_spf` include list) that
 *     backs every sender and belongs to no single domain.
 */
export const emailDnsRecordRoleEnum = pgEnum("email_dns_record_role", [
  "direct",
  "proxy",
  "shared",
]);

export type EmailDnsRecordRole =
  (typeof emailDnsRecordRoleEnum.enumValues)[number];

export const emailDnsRecordStatusEnum = pgEnum("email_dns_record_status", [
  "pending",
  "active",
  "missing",
]);

export type EmailDnsRecordStatus =
  (typeof emailDnsRecordStatusEnum.enumValues)[number];

/**
 * Every DNS record the platform tracks for email sending, whether it lives in a
 * customer's zone or in ours.
 *
 * A record targets exactly one sending domain — a `customDomain` XOR a
 * `sandboxDomain` — except `shared` records, which target neither. Records we
 * publish in Cloudflare carry `cloudflareZoneId` + `cloudflareRecordId` (paired
 * or both null); customer-published records leave them null and are verified by
 * live DNS lookup instead.
 */
export const emailDnsRecord = pgTable(
  "email_dns_record",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("edns").toString()),
    role: emailDnsRecordRoleEnum("role").notNull(),
    customDomainId: text("custom_domain_id").references(() => customDomain.id, {
      onDelete: "cascade",
    }),
    sandboxDomainId: text("sandbox_domain_id").references(
      () => sandboxDomain.id,
      { onDelete: "cascade" }
    ),
    purpose: dnsRecordPurposeEnum("purpose").notNull(),
    recordType: dnsRecordTypeEnum("record_type").notNull(),
    name: text("name").notNull(),
    value: text("value").notNull(),
    cloudflareZoneId: text("cloudflare_zone_id"),
    cloudflareRecordId: text("cloudflare_record_id"),
    status: emailDnsRecordStatusEnum("status").notNull().default("pending"),
    priority: integer("priority"),
    /**
     * Logical grouping key for managed DNS reconcile/remove (e.g.
     * `provider:…:infrastructure`, `sandbox:…`, `shared`). Null for
     * customer-published rows that are not Cloudflare-managed sets.
     */
    owner: text("owner"),
    lastCheckedAt: timestamp("last_checked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // `shared` records target no domain; every other role targets exactly one.
    check(
      "email_dns_record_scope_check",
      sql`(${t.role} = 'shared' AND ${t.customDomainId} IS NULL AND ${t.sandboxDomainId} IS NULL) OR (${t.role} <> 'shared' AND ((${t.customDomainId} IS NOT NULL) <> (${t.sandboxDomainId} IS NOT NULL)))`
    ),
    // Cloudflare ids are set together (we manage it) or not at all (customer does).
    check(
      "email_dns_record_cloudflare_pairing_check",
      sql`(${t.cloudflareZoneId} IS NULL) = (${t.cloudflareRecordId} IS NULL)`
    ),
    uniqueIndex("email_dns_record_custom_role_purpose_unique_idx")
      .on(t.customDomainId, t.role, t.purpose)
      .where(sql`${t.customDomainId} IS NOT NULL`),
    uniqueIndex("email_dns_record_sandbox_role_purpose_unique_idx")
      .on(t.sandboxDomainId, t.role, t.purpose)
      .where(sql`${t.sandboxDomainId} IS NOT NULL`),
    uniqueIndex("email_dns_record_shared_purpose_unique_idx")
      .on(t.purpose)
      .where(sql`${t.role} = 'shared'`),
    uniqueIndex("email_dns_record_cloudflare_record_unique_idx")
      .on(t.cloudflareZoneId, t.cloudflareRecordId)
      .where(sql`${t.cloudflareRecordId} IS NOT NULL`),
    index("email_dns_record_custom_domain_idx").on(t.customDomainId),
    index("email_dns_record_sandbox_domain_idx").on(t.sandboxDomainId),
    index("email_dns_record_owner_idx").on(t.owner),
  ]
);

export type EmailDnsRecord = typeof emailDnsRecord.$inferSelect;
export type EmailDnsRecordInsert = typeof emailDnsRecord.$inferInsert;
