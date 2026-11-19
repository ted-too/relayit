import { describe, expect, test } from "@effect/vitest";
import {
  computeNextCheckAt,
  computeNextDomainCheckAt,
  domainChecksStopped,
  mergeVerificationStatus,
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

describe("computeNextDomainCheckAt", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  const minutesAfter = (unverifiedChecks: number, verificationStatus = "not_verified" as const) => {
    const next = computeNextDomainCheckAt({ from, unverifiedChecks, verificationStatus });
    return {
      minutes: next.nextCheckAt && (next.nextCheckAt.getTime() - from.getTime()) / 60_000,
      unverifiedChecks: next.unverifiedChecks,
    };
  };

  test("doubles the wait after each unverified check, up to half a day", () => {
    expect(Array.from({ length: 11 }, (_, checks) => minutesAfter(checks).minutes)).toEqual([
      2, 4, 8, 16, 32, 64, 128, 256, 512, 720, 720,
    ]);
    expect(minutesAfter(3).unverifiedChecks).toBe(4);
  });

  test("sets no next check once it would fall more than seven days after the first", () => {
    // The 21st check is 6 days 17 hours in, and the 22nd would be due 7 days 5 hours in.
    expect(minutesAfter(20)).toEqual({ minutes: 720, unverifiedChecks: 21 });
    expect(minutesAfter(21)).toEqual({ minutes: null, unverifiedChecks: 21 });
    expect(minutesAfter(500)).toEqual({ minutes: null, unverifiedChecks: 500 });
  });

  test("counts a partially verified Domain as unverified", () => {
    expect(
      computeNextDomainCheckAt({
        from,
        unverifiedChecks: 21,
        verificationStatus: "partially_verified",
      }).nextCheckAt,
    ).toBeNull();
  });

  test("checks a verified Domain twice a day and forgets what came before", () => {
    expect(
      computeNextDomainCheckAt({ from, unverifiedChecks: 21, verificationStatus: "verified" }),
    ).toEqual({ nextCheckAt: new Date("2026-01-01T12:00:00.000Z"), unverifiedChecks: 0 });
  });
});

describe("domainChecksStopped", () => {
  test("is a Domain a check has run for with none due, not one never checked", () => {
    const checked = new Date();
    expect(domainChecksStopped({ lastCheckedAt: checked, nextVerifyAt: null })).toBe(true);
    expect(domainChecksStopped({ lastCheckedAt: checked, nextVerifyAt: checked })).toBe(false);
    expect(domainChecksStopped({ lastCheckedAt: null, nextVerifyAt: null })).toBe(false);
  });
});

describe("mergeVerificationStatus", () => {
  test("requires live DNS for verified", () => {
    expect(
      mergeVerificationStatus({
        activeRecords: 0,
        missingRecords: 0,
        sesDkimVerified: true,
        sesVerified: true,
      }),
    ).toBe("not_verified");

    expect(
      mergeVerificationStatus({
        activeRecords: 2,
        missingRecords: 0,
        sesDkimVerified: true,
        sesVerified: true,
      }),
    ).toBe("verified");
  });
});
