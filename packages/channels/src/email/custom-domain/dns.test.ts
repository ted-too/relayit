import { describe, expect, test } from "bun:test";
import {
  buildCustomDomainRootDnsRecords,
  customDomainIdentityDnsOwner,
  customDomainRootDnsOwner,
  ownershipChallengeHost,
  ownershipChallengeValue,
  resolveCustomDomainMailFromRecords,
} from "./dns";

describe("custom domain DNS specs", () => {
  test("buildCustomDomainRootDnsRecords emits customer-published DKIM and DMARC only", () => {
    const records = buildCustomDomainRootDnsRecords({
      dkimPublicKey: "v=DKIM1; k=rsa; p=abc",
      dkimSelector: "relayitdeadbeef",
      fqdn: "mail.acme.test",
    });

    expect(records.map((r) => r.purpose)).toEqual(["dkim", "dmarc"]);
    expect(records.every((r) => r.role === "direct")).toBe(true);
    expect(records[0]?.name).toBe("relayitdeadbeef._domainkey.mail.acme.test");
    expect(records[1]?.value).toContain("v=DMARC1; p=none;");
    expect(records.some((r) => r.purpose === "spf")).toBe(false);
  });

  test("resolveCustomDomainMailFromRecords keeps vendor values verbatim", () => {
    const records = resolveCustomDomainMailFromRecords({
      records: [
        {
          name: "send.mail.acme.test",
          priority: 10,
          purpose: "mail_from_mx",
          recordType: "MX",
          value: "feedback-smtp.example.com",
        },
        {
          name: "send.mail.acme.test",
          purpose: "mail_from_spf",
          recordType: "TXT",
          value: '"v=spf1 include:amazonses.com ~all"',
        },
      ],
    });

    expect(records).toEqual([
      {
        name: "send.mail.acme.test",
        priority: 10,
        purpose: "mail_from_mx",
        recordType: "MX",
        role: "direct",
        status: "pending",
        value: "feedback-smtp.example.com",
      },
      {
        name: "send.mail.acme.test",
        purpose: "mail_from_spf",
        recordType: "TXT",
        role: "direct",
        status: "pending",
        value: '"v=spf1 include:amazonses.com ~all"',
      },
    ]);
  });

  test("ownership challenge host and value are stable", () => {
    expect(ownershipChallengeHost("acme.test")).toBe(
      "_relayit-challenge.acme.test"
    );
    expect(ownershipChallengeValue("tok_abc")).toBe(
      '"relayit-domain-verification=tok_abc"'
    );
    expect(customDomainRootDnsOwner("dom_1")).toBe("custom:dom_1:root");
    expect(customDomainIdentityDnsOwner("dom_1", "prov_1")).toBe(
      "custom:dom_1:identity:prov_1"
    );
  });
});
