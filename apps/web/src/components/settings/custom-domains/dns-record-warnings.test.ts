import { describe, expect, test } from "bun:test";
import { dnsRecordWarningCopy } from "./dns-record-warnings";

describe("dnsRecordWarningCopy", () => {
  test("explains multiple DMARC policies", () => {
    expect(
      dnsRecordWarningCopy({
        code: "multiple_dmarc_records",
        recordCount: 2,
      })
    ).toEqual({
      description:
        "This host publishes 2 DMARC policies. Receivers pick one arbitrarily, which can break authentication. Keep a single TXT record and merge rua/ruf into it.",
      title: "Multiple DMARC records",
    });
  });
});
