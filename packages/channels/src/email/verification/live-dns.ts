import * as dns from "node:dns";
import * as net from "node:net";
import type { DnsRecordWarning } from "@repo/persistence/db/schema";

const TRAILING_DOT_REGEX = /\.$/;
const DMARC_VERSION_REGEX = /^v=dmarc1\b/i;

/** Well-peered resolvers used to find nameservers — never the ambient cache. */
const PUBLIC_RESOLVER_IPS = ["1.1.1.1", "8.8.8.8"] as const;

const RESOLVER_OPTIONS = { timeout: 2500, tries: 2 } as const;

export interface LiveDnsEvaluation {
  readonly matches: boolean;
  readonly warnings: readonly DnsRecordWarning[];
}

const isDnsNotFound = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOTFOUND" ||
    code === "ENODATA" ||
    code === "DNS_ENOTFOUND" ||
    code === "DNS_ENODATA"
  );
};

const isTransientDnsError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ETIMEOUT" ||
    code === "ESERVFAIL" ||
    code === "ECONNREFUSED" ||
    code === "EREFUSED" ||
    code === "DNS_ETIMEOUT" ||
    code === "DNS_ESERVFAIL" ||
    code === "DNS_ECONNREFUSED" ||
    code === "DNS_EREFUSED"
  );
};

const toFqdn = (host: string): string =>
  host.endsWith(".") ? host : `${host}.`;

const stripTrailingDot = (value: string): string =>
  value.replace(TRAILING_DOT_REGEX, "");

const createResolver = (servers: readonly string[]) => {
  const resolver = new dns.promises.Resolver(RESOLVER_OPTIONS);
  resolver.setServers([...servers]);
  return resolver;
};

const queryResolver = async <T>(
  servers: readonly string[],
  run: (resolver: dns.promises.Resolver) => Promise<T>,
  emptyOnNotFound: T
): Promise<T> => {
  try {
    return await run(createResolver(servers));
  } catch (error) {
    if (isDnsNotFound(error)) {
      return emptyOnNotFound;
    }
    throw error;
  }
};

const lookupNsRecords = async (host: string): Promise<string[]> =>
  queryResolver(
    PUBLIC_RESOLVER_IPS,
    (resolver) => resolver.resolveNs(toFqdn(host)),
    []
  );

export const lookupAuthoritativeNameservers = async (
  fqdn: string
): Promise<string[]> => {
  const labels = fqdn.toLowerCase().split(".");

  for (let index = 0; index < labels.length - 1; index += 1) {
    const host = labels.slice(index).join(".");
    const records = await lookupNsRecords(host);
    if (records.length > 0) {
      return records;
    }
  }

  return [];
};

const lookupIpv4 = async (host: string): Promise<string[]> =>
  queryResolver(
    PUBLIC_RESOLVER_IPS,
    (resolver) => resolver.resolve4(toFqdn(host)),
    []
  );

const lookupIpv6 = async (host: string): Promise<string[]> =>
  queryResolver(
    PUBLIC_RESOLVER_IPS,
    (resolver) => resolver.resolve6(toFqdn(host)),
    []
  );

const nameserverIps = async (
  nameservers: readonly string[]
): Promise<string[]> => {
  const ips: string[] = [];

  for (const nameserver of nameservers) {
    const hostname = stripTrailingDot(nameserver).toLowerCase();
    if (net.isIP(hostname)) {
      ips.push(hostname);
      continue;
    }

    const ipv4 = await lookupIpv4(hostname);
    if (ipv4.length > 0) {
      ips.push(...ipv4);
      continue;
    }

    const ipv6 = await lookupIpv6(hostname);
    ips.push(...ipv6);
  }

  return [...new Set(ips)];
};

const serversForHost = async (host: string): Promise<string[]> => {
  const nameservers = await lookupAuthoritativeNameservers(host);
  const ips = await nameserverIps(nameservers);
  return ips.length > 0 ? ips : [...PUBLIC_RESOLVER_IPS];
};

const lookupOnServers = async <T>(
  host: string,
  run: (resolver: dns.promises.Resolver, fqdn: string) => Promise<T>,
  emptyOnNotFound: T
): Promise<T> => {
  const fqdn = toFqdn(host);
  const authoritative = await serversForHost(host);

  try {
    return await queryResolver(
      authoritative,
      (resolver) => run(resolver, fqdn),
      emptyOnNotFound
    );
  } catch (error) {
    if (!isTransientDnsError(error)) {
      throw error;
    }

    if (
      authoritative.length === PUBLIC_RESOLVER_IPS.length &&
      authoritative.every(
        (server, index) => server === PUBLIC_RESOLVER_IPS[index]
      )
    ) {
      throw error;
    }

    return queryResolver(
      PUBLIC_RESOLVER_IPS,
      (resolver) => run(resolver, fqdn),
      emptyOnNotFound
    );
  }
};

export const lookupTxtRecords = async (host: string): Promise<string[][]> =>
  lookupOnServers(host, (resolver, fqdn) => resolver.resolveTxt(fqdn), []);

export const lookupCname = async (host: string): Promise<string | null> => {
  const records = await lookupOnServers(
    host,
    (resolver, fqdn) => resolver.resolveCname(fqdn),
    []
  );
  return records[0] ?? null;
};

export const lookupMxRecords = async (
  host: string
): Promise<{ exchange: string; priority: number }[]> =>
  lookupOnServers(host, (resolver, fqdn) => resolver.resolveMx(fqdn), []);

export const txtRecordsIncludeValue = (
  records: string[][],
  expected: string
): boolean => {
  const normalizedExpected = expected.replace(/^"|"$/g, "");
  const matchesJoined = (joined: string) =>
    joined === expected ||
    joined === normalizedExpected ||
    joined.includes(normalizedExpected);

  if (records.some((chunks) => matchesJoined(chunks.join("")))) {
    return true;
  }

  return matchesJoined(records.map((chunks) => chunks.join("")).join(""));
};

const joinedTxt = (chunks: readonly string[]): string =>
  chunks.join("").replace(/^"|"$/g, "");

export const inspectDmarcTxtRecords = (
  records: string[][]
): DnsRecordWarning[] => {
  const dmarcCount = records.filter((chunks) =>
    DMARC_VERSION_REGEX.test(joinedTxt(chunks))
  ).length;

  if (dmarcCount > 1) {
    return [{ code: "multiple_dmarc_records", recordCount: dmarcCount }];
  }

  return [];
};

const hostnamesMatch = (seen: string, expected: string): boolean => {
  const left = stripTrailingDot(seen).toLowerCase();
  const right = stripTrailingDot(expected).toLowerCase();
  return (
    left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
  );
};

export const evaluateLiveDnsRecord = async (record: {
  readonly name: string;
  readonly purpose?: string;
  readonly recordType: string;
  readonly value: string;
}): Promise<LiveDnsEvaluation> => {
  switch (record.recordType) {
    case "CNAME": {
      const seen = await lookupCname(record.name);
      return {
        matches: seen ? hostnamesMatch(seen, record.value) : false,
        warnings: [],
      };
    }
    case "TXT": {
      const txtRecords = await lookupTxtRecords(record.name);
      return {
        matches: txtRecordsIncludeValue(txtRecords, record.value),
        warnings:
          record.purpose === "dmarc" ? inspectDmarcTxtRecords(txtRecords) : [],
      };
    }
    case "MX": {
      const mxRecords = await lookupMxRecords(record.name);
      return {
        matches: mxRecords.some((mx) =>
          hostnamesMatch(mx.exchange, record.value)
        ),
        warnings: [],
      };
    }
    default:
      return { matches: false, warnings: [] };
  }
};

export const recordMatchesLiveDns = async (record: {
  readonly name: string;
  readonly purpose?: string;
  readonly recordType: string;
  readonly value: string;
}): Promise<boolean> => (await evaluateLiveDnsRecord(record)).matches;
