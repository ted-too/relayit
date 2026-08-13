import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as dns from "node:dns";
import {
  evaluateLiveDnsRecord,
  inspectDmarcTxtRecords,
  lookupAuthoritativeNameservers,
  lookupTxtRecords,
  recordMatchesLiveDns,
  txtRecordsIncludeValue,
} from "./live-dns";

const AUTH_NS_IP = "203.0.113.10";
const PUBLIC_RESOLVER_IPS = new Set(["1.1.1.1", "8.8.8.8"]);
const TRAILING_DOT_REGEX = /\.$/;

const notFound = (host: string, code = "ENOTFOUND") =>
  Object.assign(new Error(`not found: ${host}`), { code });

const normalizeHost = (host: string) =>
  host.replace(TRAILING_DOT_REGEX, "").toLowerCase();

const usesPublicResolvers = (servers: readonly string[]) =>
  servers.some((server) => PUBLIC_RESOLVER_IPS.has(server));

class FakeResolver {
  servers: string[] = [];
  authTxtByHost: Record<string, string[][]>;
  publicTxtByHost: Record<string, string[][]>;
  authMxByHost: Record<string, { exchange: string; priority: number }[]>;
  authCnameByHost: Record<string, string[]>;
  authTxtErrorByHost: Record<string, NodeJS.ErrnoException>;
  nsByHost: Record<string, string[]>;
  nsIpByHost: Record<string, string[]>;

  constructor(
    config: {
      authCnameByHost?: Record<string, string[]>;
      authMxByHost?: Record<string, { exchange: string; priority: number }[]>;
      authTxtByHost?: Record<string, string[][]>;
      authTxtErrorByHost?: Record<string, NodeJS.ErrnoException>;
      nsByHost?: Record<string, string[]>;
      nsIpByHost?: Record<string, string[]>;
      publicTxtByHost?: Record<string, string[][]>;
    } = {}
  ) {
    this.authCnameByHost = config.authCnameByHost ?? {};
    this.authMxByHost = config.authMxByHost ?? {};
    this.authTxtByHost = config.authTxtByHost ?? {};
    this.authTxtErrorByHost = config.authTxtErrorByHost ?? {};
    this.nsByHost = config.nsByHost ?? { "acme.test": ["ns1.acme.test"] };
    this.nsIpByHost = config.nsIpByHost ?? { "ns1.acme.test": [AUTH_NS_IP] };
    this.publicTxtByHost = config.publicTxtByHost ?? {};
  }

  setServers(servers: string[]) {
    this.servers = servers;
  }

  resolveNs(host: string) {
    const records = this.nsByHost[normalizeHost(host)];
    if (records && records.length > 0) {
      return Promise.resolve(records);
    }
    return Promise.reject(notFound(host, "ENODATA"));
  }

  resolve4(host: string) {
    const records = this.nsIpByHost[normalizeHost(host)];
    if (records && records.length > 0) {
      return Promise.resolve(records);
    }
    return Promise.reject(notFound(host));
  }

  resolveTxt(host: string) {
    const name = normalizeHost(host);
    if (this.servers.includes(AUTH_NS_IP)) {
      const error = this.authTxtErrorByHost[name];
      if (error) {
        return Promise.reject(error);
      }
      return Promise.resolve(this.authTxtByHost[name] ?? []);
    }
    if (usesPublicResolvers(this.servers)) {
      return Promise.resolve(this.publicTxtByHost[name] ?? []);
    }
    return Promise.reject(notFound(host));
  }

  resolveMx(host: string) {
    const name = normalizeHost(host);
    if (this.servers.includes(AUTH_NS_IP)) {
      return Promise.resolve(this.authMxByHost[name] ?? []);
    }
    return Promise.reject(notFound(host, "ENODATA"));
  }

  resolveCname(host: string) {
    const name = normalizeHost(host);
    if (this.servers.includes(AUTH_NS_IP)) {
      const records = this.authCnameByHost[name];
      if (records && records.length > 0) {
        return Promise.resolve(records);
      }
      return Promise.reject(notFound(host, "ENODATA"));
    }
    return Promise.reject(notFound(host, "ENODATA"));
  }
}

let resolverConfig: ConstructorParameters<typeof FakeResolver>[0] = {};

const installFakeResolver = (
  config: ConstructorParameters<typeof FakeResolver>[0] = {}
) => {
  resolverConfig = config;
  spyOn(dns.promises, "Resolver").mockImplementation(
    (() => new FakeResolver(resolverConfig)) as never
  );
};

afterEach(() => {
  mock.restore();
  resolverConfig = {};
});

describe("lookupAuthoritativeNameservers", () => {
  test("returns NS records at the FQDN when they exist", async () => {
    installFakeResolver({
      nsByHost: {
        "acme.test": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      },
    });

    expect(await lookupAuthoritativeNameservers("acme.test")).toEqual([
      "ada.ns.cloudflare.com",
      "bob.ns.cloudflare.com",
    ]);
  });

  test("walks toward the parent zone when the FQDN has no NS", async () => {
    installFakeResolver({
      nsByHost: { "acme.test": ["ada.ns.cloudflare.com"] },
    });

    expect(await lookupAuthoritativeNameservers("mail.acme.test")).toEqual([
      "ada.ns.cloudflare.com",
    ]);
  });
});

describe("txtRecordsIncludeValue", () => {
  test("matches a quoted SPF value against unquoted live TXT", () => {
    expect(
      txtRecordsIncludeValue(
        [["v=spf1 include:amazonses.com ~all"]],
        '"v=spf1 include:amazonses.com ~all"'
      )
    ).toBe(true);
  });

  test("joins character-string chunks of one TXT record", () => {
    expect(
      txtRecordsIncludeValue(
        [["v=DKIM1; k=rsa; p=abc", "def"]],
        "v=DKIM1; k=rsa; p=abcdef"
      )
    ).toBe(true);
  });
});

describe("inspectDmarcTxtRecords", () => {
  test("flags more than one v=DMARC1 record", () => {
    expect(
      inspectDmarcTxtRecords([
        ["v=DMARC1; p=none;"],
        ["v=DMARC1; p=quarantine; rua=mailto:security@acme.test; sp=none;"],
      ])
    ).toEqual([{ code: "multiple_dmarc_records", recordCount: 2 }]);
  });

  test("ignores unrelated TXT records at the same name", () => {
    expect(
      inspectDmarcTxtRecords([
        ["v=DMARC1; p=none;"],
        ["google-site-verification=abc"],
      ])
    ).toEqual([]);
  });

  test("returns no issue when DMARC is absent", () => {
    expect(inspectDmarcTxtRecords([["v=spf1 ~all"]])).toEqual([]);
  });
});

describe("authoritative live DNS lookups", () => {
  test("sees a TXT that public resolvers still miss", async () => {
    installFakeResolver({
      authTxtByHost: {
        "send.acme.test": [["v=spf1 include:amazonses.com ~all"]],
      },
      publicTxtByHost: {},
    });

    expect(await lookupTxtRecords("send.acme.test")).toEqual([
      ["v=spf1 include:amazonses.com ~all"],
    ]);
  });

  test("matches MAIL FROM SPF against the nameserver answer", async () => {
    installFakeResolver({
      authTxtByHost: {
        "send.acme.test": [["v=spf1 include:amazonses.com ~all"]],
      },
    });

    expect(
      await recordMatchesLiveDns({
        name: "send.acme.test",
        recordType: "TXT",
        value: '"v=spf1 include:amazonses.com ~all"',
      })
    ).toBe(true);
  });

  test("falls back to public resolvers when the nameserver times out", async () => {
    installFakeResolver({
      authTxtErrorByHost: {
        "send.acme.test": Object.assign(new Error("timeout"), {
          code: "ETIMEOUT",
        }),
      },
      publicTxtByHost: {
        "send.acme.test": [["v=spf1 include:amazonses.com ~all"]],
      },
    });

    expect(await lookupTxtRecords("send.acme.test")).toEqual([
      ["v=spf1 include:amazonses.com ~all"],
    ]);
  });

  test("does not treat a nameserver miss as a public-resolver hit", async () => {
    installFakeResolver({
      publicTxtByHost: {
        "send.acme.test": [["v=spf1 include:amazonses.com ~all"]],
      },
    });

    expect(await lookupTxtRecords("send.acme.test")).toEqual([]);
  });

  test("matches MX and CNAME targets with or without a trailing dot", async () => {
    installFakeResolver({
      authCnameByHost: {
        "relayit._domainkey.acme.test": ["dkim.relayit.fyi."],
      },
      authMxByHost: {
        "send.acme.test": [
          {
            exchange: "feedback-smtp.eu-central-1.amazonses.com.",
            priority: 10,
          },
        ],
      },
    });

    expect(
      await recordMatchesLiveDns({
        name: "send.acme.test",
        recordType: "MX",
        value: "feedback-smtp.eu-central-1.amazonses.com",
      })
    ).toBe(true);

    expect(
      await recordMatchesLiveDns({
        name: "relayit._domainkey.acme.test",
        recordType: "CNAME",
        value: "dkim.relayit.fyi",
      })
    ).toBe(true);
  });

  test("accepts a stricter existing DMARC policy instead of p=none", async () => {
    installFakeResolver({
      authTxtByHost: {
        "_dmarc.acme.test": [
          [
            "v=DMARC1; p=quarantine; rua=mailto:security@acme.test; ruf=mailto:security@acme.test; sp=none; adkim=r; aspf=r",
          ],
        ],
      },
    });

    expect(
      await evaluateLiveDnsRecord({
        name: "_dmarc.acme.test",
        purpose: "dmarc",
        recordType: "TXT",
        value: '"v=DMARC1; p=none;"',
      })
    ).toEqual({
      matches: true,
      warnings: [],
    });
  });

  test("does not treat a missing DMARC policy as verified", async () => {
    installFakeResolver({
      authTxtByHost: {
        "_dmarc.acme.test": [["google-site-verification=abc"]],
      },
    });

    expect(
      await evaluateLiveDnsRecord({
        name: "_dmarc.acme.test",
        purpose: "dmarc",
        recordType: "TXT",
        value: '"v=DMARC1; p=none;"',
      })
    ).toEqual({
      matches: false,
      warnings: [],
    });
  });

  test("reports multiple DMARC policies without failing our record match", async () => {
    installFakeResolver({
      authTxtByHost: {
        "_dmarc.acme.test": [
          ["v=DMARC1; p=none;"],
          ["v=DMARC1; p=quarantine; rua=mailto:security@acme.test"],
        ],
      },
    });

    expect(
      await evaluateLiveDnsRecord({
        name: "_dmarc.acme.test",
        purpose: "dmarc",
        recordType: "TXT",
        value: '"v=DMARC1; p=none;"',
      })
    ).toEqual({
      matches: true,
      warnings: [{ code: "multiple_dmarc_records", recordCount: 2 }],
    });
  });
});
