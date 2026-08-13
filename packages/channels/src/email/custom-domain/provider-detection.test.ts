import { describe, expect, test } from "bun:test";
import { providerFromNameservers } from "./provider-detection";

describe("providerFromNameservers", () => {
  test("returns unknown when no nameservers are present", () => {
    expect(providerFromNameservers([])).toBe("unknown");
  });

  test("detects Cloudflare from ns.cloudflare.com hostnames", () => {
    expect(
      providerFromNameservers([
        "ada.ns.cloudflare.com",
        "bob.ns.cloudflare.com",
      ])
    ).toBe("cloudflare");
  });

  test("detects Route 53 from awsdns hostnames", () => {
    expect(
      providerFromNameservers([
        "ns-1234.awsdns-12.com",
        "ns-5678.awsdns-34.net",
      ])
    ).toBe("route53");
  });

  test("normalizes trailing dots and case before matching", () => {
    expect(providerFromNameservers(["ADA.NS.CLOUDFLARE.COM."])).toBe(
      "cloudflare"
    );
  });

  test("returns unknown for unrecognized nameservers", () => {
    expect(providerFromNameservers(["ns1.example-registrar.test"])).toBe(
      "unknown"
    );
  });

  test("matches known DNS host suffixes", () => {
    const examples = [
      ["ns1.vercel-dns.com", "vercel"],
      ["ns1.dnsimple.com", "dnsimple"],
      ["dns1.p01.nsone.net", "ns1"],
      ["ns1.digitalocean.com", "digitalocean"],
      ["ns1.domaincontrol.com", "godaddy"],
      ["dns1.registrar-servers.com", "namecheap"],
      ["ns1.hover.com", "hover"],
      ["curitiba.ns.porkbun.com", "porkbun"],
      ["ns1.dreamhost.com", "dreamhost"],
      ["ns1.ui-dns.com", "ionos"],
      ["dns19.ovh.net", "ovh"],
      ["a.dns.gandi.net", "gandi"],
      ["ns1.dynadot.com", "dynadot"],
      ["ns1.wixdns.net", "wix"],
      ["ns1.squarespace.com", "squarespace"],
      ["dns1.p01.netlify.com", "netlify"],
      ["ns1.shopify.com", "shopify"],
      ["ns1.bluehost.com", "bluehost"],
      ["ns1.hostgator.com", "hostgator"],
      ["ns-cloud-a1.googledomains.com", "google"],
      ["ns1-01.azure-dns.com", "azure"],
      ["ns1.name.com", "namecom"],
    ] as const;

    for (const [nameserver, provider] of examples) {
      expect(providerFromNameservers([nameserver])).toBe(provider);
    }
  });
});
