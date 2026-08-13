import { describe, expect, test } from "bun:test";
import {
  buildSandboxRootDnsRecords,
  resolveSandboxMailFromRecords,
  sandboxIdentityDnsOwner,
  sandboxRootDnsOwner,
} from "./dns";

describe("sandbox dns helpers", () => {
  test("owners are stable per sandbox and identity", () => {
    expect(sandboxRootDnsOwner("sbxd_1")).toBe("sandbox:sbxd_1:root");
    expect(sandboxIdentityDnsOwner("sbxd_1", "prov_1")).toBe(
      "sandbox:sbxd_1:identity:prov_1"
    );
  });

  test("buildSandboxRootDnsRecords emits DKIM and DMARC", () => {
    const records = buildSandboxRootDnsRecords({
      dkimPublicKey: "v=DKIM1; k=rsa; p=abc",
      dkimSelector: "relayitabcd",
      fqdn: "relayit.fyi",
    });

    expect(records).toEqual([
      {
        name: "relayitabcd._domainkey.relayit.fyi",
        purpose: "dkim",
        recordType: "TXT",
        role: "direct",
        status: "pending",
        value: '"v=DKIM1; k=rsa; p=abc"',
      },
      {
        name: "_dmarc.relayit.fyi",
        purpose: "dmarc",
        recordType: "TXT",
        role: "direct",
        status: "pending",
        value: '"v=DMARC1; p=none;"',
      },
    ]);
  });

  test("resolveSandboxMailFromRecords keeps vendor SPF verbatim", () => {
    const records = resolveSandboxMailFromRecords({
      records: [
        {
          name: "send.relayit.fyi",
          priority: 10,
          purpose: "mail_from_mx",
          recordType: "MX",
          value: "feedback-smtp.us-east-1.amazonses.com",
        },
        {
          name: "send.relayit.fyi",
          priority: null,
          purpose: "mail_from_spf",
          recordType: "TXT",
          value: '"v=spf1 include:amazonses.com ~all"',
        },
      ],
    });

    expect(records[1]).toMatchObject({
      purpose: "mail_from_spf",
      value: '"v=spf1 include:amazonses.com ~all"',
    });
    expect(records[0]?.priority).toBe(10);
  });
});
