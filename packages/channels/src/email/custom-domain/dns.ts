import { randomBytes } from "node:crypto";
import { dkimRecordName, formatDkimTxtRecord } from "../dkim";
import { formatTxtRecordContent, type ManagedDnsRecord } from "../managed-dns";
import type { MailFromDnsRecord } from "../provider-adapter";

const OWNERSHIP_PREFIX = "relayit-domain-verification=";

export const customDomainRootDnsOwner = (customDomainId: string) =>
  `custom:${customDomainId}:root`;

export const customDomainIdentityDnsOwner = (
  customDomainId: string,
  providerId: string
) => `custom:${customDomainId}:identity:${providerId}`;

/** Customer-published root records (DKIM + DMARC). No platform SPF / CF auto-manage. */
export const buildCustomDomainRootDnsRecords = (input: {
  readonly dkimPublicKey: string;
  readonly dkimSelector: string;
  readonly fqdn: string;
}): readonly ManagedDnsRecord[] => [
  {
    name: dkimRecordName(input.dkimSelector, input.fqdn),
    purpose: "dkim",
    recordType: "TXT",
    role: "direct",
    status: "pending",
    value: formatDkimTxtRecord(input.dkimPublicKey),
  },
  {
    name: `_dmarc.${input.fqdn}`,
    purpose: "dmarc",
    recordType: "TXT",
    role: "direct",
    status: "pending",
    value: formatTxtRecordContent("v=DMARC1; p=none;"),
  },
];

/** Vendor MAIL FROM records verbatim for customer publish. */
export const resolveCustomDomainMailFromRecords = (input: {
  readonly records: readonly MailFromDnsRecord[];
}): readonly ManagedDnsRecord[] =>
  input.records.map((record) => ({
    name: record.name,
    ...(record.priority === null || record.priority === undefined
      ? {}
      : { priority: record.priority }),
    purpose: record.purpose,
    recordType: record.recordType,
    role: "direct" as const,
    status: "pending" as const,
    value: record.value,
  }));

export const ownershipChallengeHost = (fqdn: string): string =>
  `_relayit-challenge.${fqdn}`;

export const ownershipChallengeValue = (token: string): string =>
  formatTxtRecordContent(`${OWNERSHIP_PREFIX}${token}`);

export const createOwnershipToken = (): string =>
  randomBytes(24).toString("hex");
