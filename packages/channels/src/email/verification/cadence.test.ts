import { describe, expect, test } from "bun:test";
import { computeNextCheckAt, mergeVerificationStatus } from "./cadence";

describe("computeNextCheckAt", () => {
  test("verified resets backoff and uses long interval", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const result = computeNextCheckAt({
      backoffLevel: 3,
      from,
      verificationStatus: "verified",
    });
    expect(result.backoffLevel).toBe(0);
    expect(result.nextCheckAt.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });

  test("not_verified doubles pending interval and increments level", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const result = computeNextCheckAt({
      backoffLevel: 0,
      from,
      verificationStatus: "not_verified",
    });
    expect(result.backoffLevel).toBe(1);
    expect(result.nextCheckAt.toISOString()).toBe("2026-01-01T00:02:00.000Z");
  });
});

describe("mergeVerificationStatus", () => {
  test("requires live DNS for verified", () => {
    expect(
      mergeVerificationStatus({
        activeRecords: 0,
        missingRecords: 0,
        providerDkimVerified: true,
        providerVerified: true,
      })
    ).toBe("not_verified");

    expect(
      mergeVerificationStatus({
        activeRecords: 2,
        missingRecords: 0,
        providerDkimVerified: true,
        providerVerified: true,
      })
    ).toBe("verified");
  });
});
