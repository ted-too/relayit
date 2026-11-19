import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { customDomain } from "./custom-domain";
import { domainVerificationStatusEnum } from "./domain";
import { sandboxDomain } from "./sandbox-domain";

/**
 * A Domain's or Sandbox Domain's registration with SES: one per domain, made when the
 * domain is added. `verificationStatus` is what SES reports for the identity; the
 * domain's own status rolls that up with its DNS records.
 *
 * The table keeps its name from when a domain could be registered with several
 * Providers; renaming it would move every row for nothing.
 */
export const emailDomainRegistration = pgTable(
  "email_domain_provider_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("epid").toString()),
    customDomainId: text("custom_domain_id").references(() => customDomain.id, {
      onDelete: "cascade",
    }),
    sandboxDomainId: text("sandbox_domain_id").references(() => sandboxDomain.id, {
      onDelete: "cascade",
    }),
    /**
     * The SES region the identity was created in, from `SES_REGIONS`. Null on
     * registrations made before regions were recorded: those are in the deployment's
     * default region, the first of `SES_REGIONS`.
     */
    region: text("region"),
    verificationStatus: domainVerificationStatusEnum("verification_status")
      .notNull()
      .default("not_verified"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "email_domain_provider_identity_domain_kind_check",
      sql`(${t.customDomainId} IS NOT NULL) <> (${t.sandboxDomainId} IS NOT NULL)`,
    ),
    uniqueIndex("email_domain_registration_custom_domain_uidx")
      .on(t.customDomainId)
      .where(sql`${t.customDomainId} IS NOT NULL`),
    uniqueIndex("email_domain_registration_sandbox_domain_uidx")
      .on(t.sandboxDomainId)
      .where(sql`${t.sandboxDomainId} IS NOT NULL`),
  ],
);

export type EmailDomainRegistration = typeof emailDomainRegistration.$inferSelect;

/**
 * The SES identity of a Domain that was removed, until its delete job has deleted it or
 * has found none after the time a late create could still land. The identity
 * outlives the Domain's row by as long as its delete job takes, and SES names it by FQDN
 * alone, so an add of the same FQDN in that time finds an identity signing with a selector
 * that is not its own. This row is what says the identity was Relayit's, and so may be
 * deleted to make way for the new Domain's, where one nobody recorded is left alone.
 */
export const removedDomainIdentity = pgTable(
  "removed_domain_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("rmid").toString()),
    fqdn: text("fqdn").notNull(),
    /** As on the registration: null is the deployment's default region. */
    region: text("region"),
    dkimSelector: text("dkim_selector").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("removed_domain_identity_fqdn_idx").on(t.fqdn)],
);
