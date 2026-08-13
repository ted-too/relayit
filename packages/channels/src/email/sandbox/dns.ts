import { dkimRecordName, formatDkimTxtRecord } from "../dkim";
import { formatTxtRecordContent, type ManagedDnsRecord } from "../managed-dns";
import type { MailFromDnsRecord } from "../provider-adapter";

export {
  createDomainKeyMaterial,
  type DomainKeyMaterial,
} from "../dkim";

export const sandboxRootDnsOwner = (sandboxDomainId: string) =>
  `sandbox:${sandboxDomainId}:root`;

export const sandboxIdentityDnsOwner = (
  sandboxDomainId: string,
  providerId: string
) => `sandbox:${sandboxDomainId}:identity:${providerId}`;

export const buildSandboxRootDnsRecords = (input: {
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

/**
 * Map Provider MAIL FROM records into managed DNS rows (vendor values verbatim).
 */
export const resolveSandboxMailFromRecords = (input: {
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
