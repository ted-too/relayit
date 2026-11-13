import type { DnsRecordWarning, DomainProvider } from "@repo/persistence/db/schema";

export interface ProjectDomainDnsRecord {
  readonly lastCheckedAt: Date | null;
  readonly name: string;
  readonly priority: number | null;
  readonly purpose: string;
  readonly recordType: string;
  readonly status: string;
  readonly value: string;
  readonly warnings: readonly DnsRecordWarning[];
}

export interface ProjectDomainListItem {
  readonly createdAt: Date;
  readonly dnsRecords: {
    readonly dkimAndSpf: readonly ProjectDomainDnsRecord[];
    readonly dmarc: readonly ProjectDomainDnsRecord[];
    readonly ownership: readonly ProjectDomainDnsRecord[];
  };
  readonly fqdn: string;
  readonly id: string;
  readonly isPaused: boolean;
  readonly lastCheckedAt: Date | null;
  readonly ownership: {
    readonly status: "active" | "missing" | "pending";
  };
  readonly pausedReason: "bad_reputation" | "manual_admin_pause" | null;
  readonly provider: DomainProvider;
  readonly verificationStatus: "not_verified" | "partially_verified" | "verified";
}
