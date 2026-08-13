import type { DnsRecordWarning } from "@repo/persistence/db/schema";

export const dnsRecordWarningCopy = (
  warning: DnsRecordWarning
): { description: string; title: string } => {
  switch (warning.code) {
    case "multiple_dmarc_records":
      return {
        description: `This host publishes ${warning.recordCount} DMARC policies. Receivers pick one arbitrarily, which can break authentication. Keep a single TXT record and merge rua/ruf into it.`,
        title: "Multiple DMARC records",
      };
    default:
      return {
        description: "This host has a DNS configuration issue.",
        title: "DNS issue",
      };
  }
};
