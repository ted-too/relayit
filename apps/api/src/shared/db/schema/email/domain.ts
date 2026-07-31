import { pgEnum } from "drizzle-orm/pg-core";
import * as z from "zod";

/**
 * Enums shared by the two flavours of email sending domain — a user's own
 * `customDomain` (e.g. `acme.com`) and a platform-owned `sandboxDomain` root
 * (e.g. `relayit.fyi`). They live here so neither domain module has to import
 * the other.
 *
 * Both flavours run the same DNS-backed verification loop: we publish/await DNS
 * records, poll the provider until it reports the identity can send, and track
 * progress with `verificationStatus`. `*_paused` state is orthogonal to
 * verification — a verified domain can still be paused for reputation/abuse.
 */
export const domainVerificationStatusEnum = pgEnum(
  "domain_verification_status",
  ["not_verified", "partially_verified", "verified"]
);

export type DomainVerificationStatus =
  (typeof domainVerificationStatusEnum.enumValues)[number];

export const domainPausedReasonEnum = pgEnum("domain_paused_reason", [
  "bad_reputation",
  "manual_admin_pause",
]);

export type DomainPausedReason =
  (typeof domainPausedReasonEnum.enumValues)[number];

/**
 * What a given DNS record proves (`dkim`/`spf`/`dmarc` all authenticate the
 * sender) and its DNS type. Owned here — columns store these values.
 */
export const AVAILABLE_DNS_RECORD_PURPOSES = [
  "dkim",
  "spf",
  "dmarc",
  "ownership",
  "mail_from_mx",
  "mail_from_spf",
  "dmarc_report_auth",
] as const;

export const zDnsRecordPurpose = z.enum(AVAILABLE_DNS_RECORD_PURPOSES);

export type DnsRecordPurpose = (typeof AVAILABLE_DNS_RECORD_PURPOSES)[number];

export const AVAILABLE_DNS_RECORD_TYPES = ["CNAME", "TXT", "MX"] as const;

export const zDnsRecordType = z.enum(AVAILABLE_DNS_RECORD_TYPES);

export type DnsRecordType = (typeof AVAILABLE_DNS_RECORD_TYPES)[number];

export const dnsRecordPurposeEnum = pgEnum(
  "dns_record_purpose",
  AVAILABLE_DNS_RECORD_PURPOSES
);

export const dnsRecordTypeEnum = pgEnum(
  "dns_record_type",
  AVAILABLE_DNS_RECORD_TYPES
);
