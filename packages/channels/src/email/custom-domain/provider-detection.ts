import type { DomainProvider } from "@repo/persistence/db/schema";
import { lookupAuthoritativeNameservers } from "../verification/live-dns";

const TRAILING_DOT_REGEX = /\.$/;
const ROUTE53_NS_REMAINDER_REGEX = /^\d+\.(org|co\.uk|com|net|cn)$/;

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

const nameserverMatches = (
  nameserver: string,
  pattern: (typeof DNS_PROVIDER_PATTERNS)[number]
): boolean => {
  if (pattern.provider === "route53") {
    return pattern.suffixes.some((fragment) => {
      const index = nameserver.indexOf(fragment);
      if (index === -1) {
        return false;
      }

      const remainder = nameserver.slice(index + fragment.length);
      return ROUTE53_NS_REMAINDER_REGEX.test(remainder);
    });
  }

  return pattern.suffixes.some((suffix) => nameserver.endsWith(suffix));
};

export const providerFromNameservers = (
  nameservers: readonly string[]
): DomainProvider => {
  const normalized = nameservers.map((hostname) =>
    hostname.toLowerCase().replace(TRAILING_DOT_REGEX, "")
  );

  for (const pattern of DNS_PROVIDER_PATTERNS) {
    if (
      normalized.some((nameserver) => nameserverMatches(nameserver, pattern))
    ) {
      return pattern.provider;
    }
  }

  return "unknown";
};

export const detectDnsProvider = async (
  fqdn: string
): Promise<DomainProvider> => {
  const nameservers = await lookupAuthoritativeNameservers(fqdn);
  return providerFromNameservers(nameservers);
};
