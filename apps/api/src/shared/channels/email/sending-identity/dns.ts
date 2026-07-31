/**
 * DNS lookups, DKIM helpers, ownership challenges, and registrar detection for
 * email sending-identity verification.
 *
 * Bun implements `node:dns` with its own resolver and caching; use `dns.promises`
 * for record types (TXT, CNAME). See https://bun.com/docs/runtime/networking/dns
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import * as dns from "node:dns";
import type { DomainProvider } from "@repo/api/db";

const PEM_HEADER_REGEX = /-----BEGIN [^-]+-----/;
const PEM_FOOTER_REGEX = /-----END [^-]+-----/;
const WHITESPACE_REGEX = /\s/g;
const OWNERSHIP_PREFIX = "relayit-domain-verification=";
const TRAILING_DOT_RE = /\.$/;
const ROUTE53_NS_REMAINDER_RE = /^\d+\.(org|co\.uk|com|net|cn)$/;

function isDnsNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOTFOUND" ||
    code === "ENODATA" ||
    code === "DNS_ENOTFOUND" ||
    code === "DNS_ENODATA"
  );
}

export async function lookupTxtRecords(host: string): Promise<string[][]> {
  try {
    return await dns.promises.resolveTxt(host);
  } catch (error) {
    if (isDnsNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function lookupCname(host: string): Promise<string | null> {
  try {
    const records = await dns.promises.resolveCname(host);
    return records[0] ?? null;
  } catch (error) {
    if (isDnsNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function lookupMxRecords(
  host: string
): Promise<{ exchange: string; priority: number }[]> {
  try {
    return await dns.promises.resolveMx(host);
  } catch (error) {
    if (isDnsNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function lookupNsRecords(host: string): Promise<string[]> {
  try {
    return await dns.promises.resolveNs(host);
  } catch (error) {
    if (isDnsNotFound(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Walk from `fqdn` toward the registrable zone until NS records are found.
 * Works for apex domains and delegated subdomains without a public-suffix list.
 */
export async function lookupAuthoritativeNameservers(
  fqdn: string
): Promise<string[]> {
  const labels = fqdn.toLowerCase().split(".");

  for (let index = 0; index < labels.length - 1; index++) {
    const host = labels.slice(index).join(".");
    const records = await lookupNsRecords(host);
    if (records.length > 0) {
      return records;
    }
  }

  return [];
}

export function txtRecordsIncludeValue(
  records: string[][],
  expected: string
): boolean {
  const normalizedExpected = expected.replace(/^"|"$/g, "");

  const matchesJoined = (joined: string) =>
    joined === expected ||
    joined === normalizedExpected ||
    joined.includes(normalizedExpected);

  // Per-record match: Node groups a TXT record's character-strings into one
  // array, and short records are a single chunk.
  if (records.some((chunks) => matchesJoined(chunks.join("")))) {
    return true;
  }

  // Bun's resolver returns each 255-char character-string of a single TXT
  // record as a separate entry, so also test the concatenation of every chunk.
  // This is what lets long DKIM keys (split across strings) match.
  return matchesJoined(records.map((chunks) => chunks.join("")).join(""));
}

/** Cloudflare requires TXT record content to be wrapped in quotation marks. */
export function formatTxtRecordContent(content: string): string {
  const trimmed = content.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }

  return `"${trimmed}"`;
}

// --- DKIM -------------------------------------------------------------------

export interface DkimKeypair {
  privateKey: string;
  publicKeyDns: string;
  selector: string;
}

/**
 * Generate a BYODKIM RSA-2048 keypair and a DNS-ready public key fragment.
 */
export function generateDkimKeypair(): DkimKeypair {
  const selector = `relayit${randomBytes(4).toString("hex")}`;

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    // SES BYODKIM wants the private key as single-line base64 PKCS#8 DER
    // (no PEM armor/newlines), so emit DER bytes and base64-encode them.
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  const publicKeyBase64 = publicKey
    .replace(PEM_HEADER_REGEX, "")
    .replace(PEM_FOOTER_REGEX, "")
    .replace(WHITESPACE_REGEX, "");

  const publicKeyDns = `v=DKIM1; k=rsa; p=${publicKeyBase64}`;

  return { selector, privateKey: privateKey.toString("base64"), publicKeyDns };
}

export function dkimRecordName(selector: string, fqdn: string): string {
  return `${selector}._domainkey.${fqdn}`;
}

export function dkimBrandedProxyName(selector: string): string {
  return `${selector}._domainkey`;
}

export function formatDkimTxtRecord(publicKeyDns: string): string {
  return formatTxtRecordContent(publicKeyDns);
}

// --- Ownership challenge ----------------------------------------------------

export const ownershipChallengeHost = (fqdn: string): string =>
  `_relayit-challenge.${fqdn}`;

export const ownershipChallengeValue = (token: string): string =>
  formatTxtRecordContent(`${OWNERSHIP_PREFIX}${token}`);

export async function verifyOwnershipDns(
  fqdn: string,
  token: string
): Promise<boolean> {
  const host = ownershipChallengeHost(fqdn);
  const records = await lookupTxtRecords(host);
  return txtRecordsIncludeValue(records, ownershipChallengeValue(token));
}

// --- Registrar detection ----------------------------------------------------

const DNS_PROVIDER_PATTERNS = [
  {
    provider: "cloudflare",
    suffixes: [".ns.cloudflare.com", ".cloudflare.com"],
  },
  {
    provider: "route53",
    suffixes: [".awsdns-", ".awsdns-cn-"],
  },
  {
    provider: "google",
    suffixes: [".googledomains.com", ".googleusercontent.com"],
  },
  {
    provider: "azure",
    suffixes: [
      ".azure-dns.com",
      ".azure-dns.net",
      ".azure-dns.org",
      ".azure-dns.info",
      ".azure-dns.de",
    ],
  },
  {
    provider: "vercel",
    suffixes: [".vercel-dns.com"],
  },
  {
    provider: "dnsimple",
    suffixes: [".dnsimple.com", ".dnsimple-edge.org", ".dnsimple-edge.net"],
  },
  {
    provider: "netlify",
    suffixes: [".netlify.com", ".netlifydns.com"],
  },
  {
    provider: "ns1",
    suffixes: [".nsone.net", ".ns1.com"],
  },
  {
    provider: "digitalocean",
    suffixes: [".digitalocean.com"],
  },
  {
    provider: "godaddy",
    suffixes: [".domaincontrol.com", ".secureserver.net"],
  },
  {
    provider: "namecheap",
    suffixes: [".registrar-servers.com", ".namecheaphosting.com"],
  },
  {
    provider: "hover",
    suffixes: [".hover.com"],
  },
  {
    provider: "porkbun",
    suffixes: [".porkbun.com"],
  },
  {
    provider: "dreamhost",
    suffixes: [".dreamhost.com"],
  },
  {
    provider: "ionos",
    suffixes: [
      ".ui-dns.com",
      ".ui-dns.de",
      ".ui-dns.biz",
      ".ui-dns.org",
      ".ui-dns.net",
    ],
  },
  {
    provider: "ovh",
    suffixes: [".ovh.net", ".ovh.com"],
  },
  {
    provider: "gandi",
    suffixes: [".gandi.net"],
  },
  {
    provider: "dynadot",
    suffixes: [".dynadot.com"],
  },
  {
    provider: "namecom",
    suffixes: [".name.com"],
  },
  {
    provider: "wix",
    suffixes: [".wixdns.net"],
  },
  {
    provider: "squarespace",
    suffixes: [".squarespace.com", ".squarespace-dns.com"],
  },
  {
    provider: "shopify",
    suffixes: [".shopify.com"],
  },
  {
    provider: "bluehost",
    suffixes: [".bluehost.com"],
  },
  {
    provider: "hostgator",
    suffixes: [".hostgator.com", ".websitewelcome.com"],
  },
] as const satisfies ReadonlyArray<{
  provider: Exclude<DomainProvider, "unknown">;
  suffixes: readonly string[];
}>;

export async function detectDnsProvider(fqdn: string): Promise<DomainProvider> {
  const nameservers = (await lookupAuthoritativeNameservers(fqdn)).map(
    (hostname) => hostname.toLowerCase().replace(TRAILING_DOT_RE, "")
  );

  for (const pattern of DNS_PROVIDER_PATTERNS) {
    const matched = nameservers.some((nameserver) => {
      if (pattern.provider === "route53") {
        return pattern.suffixes.some((fragment) => {
          const index = nameserver.indexOf(fragment);
          if (index === -1) {
            return false;
          }

          const remainder = nameserver.slice(index + fragment.length);
          return ROUTE53_NS_REMAINDER_RE.test(remainder);
        });
      }

      return pattern.suffixes.some((suffix) => nameserver.endsWith(suffix));
    });

    if (matched) {
      return pattern.provider;
    }
  }

  return "unknown";
}
