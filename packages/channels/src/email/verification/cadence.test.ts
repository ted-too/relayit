import { describe, expect, test } from "bun:test";
import {
  computeNextCheckAt,
  mergeVerificationStatus,
  nextDomainVerifyAt,
} from "./cadence";

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

  test("partially_verified keeps the pending interval without raising backoff", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const result = computeNextCheckAt({
      backoffLevel: 0,
      from,
      verificationStatus: "partially_verified",
    });
    expect(result.backoffLevel).toBe(0);
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

describe("nextDomainVerifyAt", () => {
  test("keeps polling DNS when the Provider is already verified", () => {
    expect(
      nextDomainVerifyAt({
        identityNextCheckAt: new Date("2026-01-01T12:00:00.000Z"),
        nextCheckAt: new Date("2026-01-01T00:02:00.000Z"),
      }).toISOString()
    ).toBe("2026-01-01T00:02:00.000Z");
  });

  test("keeps polling the Provider when DNS is already verified", () => {
    expect(
      nextDomainVerifyAt({
        identityNextCheckAt: new Date("2026-01-01T00:02:00.000Z"),
        nextCheckAt: new Date("2026-01-01T12:00:00.000Z"),
      }).toISOString()
    ).toBe("2026-01-01T00:02:00.000Z");
  });

  test("falls back to Provider cadence when the Domain has no next check", () => {
    expect(
      nextDomainVerifyAt({
        identityNextCheckAt: new Date("2026-01-01T12:00:00.000Z"),
        nextCheckAt: null,
      }).toISOString()
    ).toBe("2026-01-01T12:00:00.000Z");
  });
});
