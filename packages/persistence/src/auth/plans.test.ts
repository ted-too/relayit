import { describe, expect, test } from "bun:test";
import type { PromiseDb } from "../db/promise";
import {
  BROADCAST_LIMITS,
  ensureUserLimits,
  FREE_LIMITS,
  limitsFor,
  resolveUserPlanName,
  SIGNAL_LIMITS,
  syncSessionUserLimits,
} from "./plans";

describe("limitsFor", () => {
  test("returns free limits when the plan name is omitted", () => {
    expect(limitsFor({})).toEqual(FREE_LIMITS);
  });

  test("returns free limits when the plan name is unknown", () => {
    expect(limitsFor({ planName: "enterprise" })).toEqual(FREE_LIMITS);
  });

  test("returns Signal limits for the signal plan", () => {
    expect(limitsFor({ planName: "signal" })).toEqual(SIGNAL_LIMITS);
  });

  test("returns Broadcast limits for the broadcast plan", () => {
    expect(limitsFor({ planName: "broadcast" })).toEqual(BROADCAST_LIMITS);
  });

  test("returns unlimited entitlements for self-hosted", () => {
    expect(limitsFor({ selfHosted: true })).toEqual({
      projects: null,
      retention: null,
      email: {
        byoProviders: true,
        customDomains: null,
        transactional: {
          managed: { monthlySends: null, dailySends: null },
          byo: { monthlySends: null, dailySends: null },
        },
        marketing: {
          managed: { monthlySends: null, dailySends: null },
          byo: { monthlySends: null, dailySends: null },
        },
      },
    });
  });

  test("matches plan names case-insensitively", () => {
    expect(limitsFor({ planName: "Signal" })).toEqual(SIGNAL_LIMITS);
  });
});

const dbWithSubscriptions = (
  subscriptions: ReadonlyArray<{
    periodEnd: Date | null;
    periodStart: Date | null;
    plan: string;
    status: string;
  }>
) =>
  ({
    query: {
      subscription: {
        findMany: async () => subscriptions,
      },
    },
  }) as unknown as PromiseDb;

describe("resolveUserPlanName", () => {
  const now = new Date("2026-08-14T00:00:00.000Z");

  test("returns free when the user has no subscriptions", async () => {
    expect(
      await resolveUserPlanName(dbWithSubscriptions([]), "user_1", now)
    ).toBe("free");
  });

  test("returns the plan of an active subscription in the current period", async () => {
    expect(
      await resolveUserPlanName(
        dbWithSubscriptions([
          {
            plan: "signal",
            status: "active",
            periodStart: new Date("2026-08-01T00:00:00.000Z"),
            periodEnd: new Date("2026-09-01T00:00:00.000Z"),
          },
        ]),
        "user_1",
        now
      )
    ).toBe("signal");
  });

  test("returns free when the subscription period has already ended", async () => {
    expect(
      await resolveUserPlanName(
        dbWithSubscriptions([
          {
            plan: "signal",
            status: "active",
            periodStart: new Date("2026-07-01T00:00:00.000Z"),
            periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          },
        ]),
        "user_1",
        now
      )
    ).toBe("free");
  });

  test("returns the plan of a trialing subscription in the current period", async () => {
    expect(
      await resolveUserPlanName(
        dbWithSubscriptions([
          {
            plan: "broadcast",
            status: "trialing",
            periodStart: new Date("2026-08-01T00:00:00.000Z"),
            periodEnd: new Date("2026-09-01T00:00:00.000Z"),
          },
        ]),
        "user_1",
        now
      )
    ).toBe("broadcast");
  });

  test("returns free when the active subscription plan name is unknown", async () => {
    expect(
      await resolveUserPlanName(
        dbWithSubscriptions([
          {
            plan: "enterprise",
            status: "active",
            periodStart: new Date("2026-08-01T00:00:00.000Z"),
            periodEnd: new Date("2026-09-01T00:00:00.000Z"),
          },
        ]),
        "user_1",
        now
      )
    ).toBe("free");
  });

  test("returns free when the subscription is canceled even if the period is current", async () => {
    expect(
      await resolveUserPlanName(
        dbWithSubscriptions([
          {
            plan: "signal",
            status: "canceled",
            periodStart: new Date("2026-08-01T00:00:00.000Z"),
            periodEnd: new Date("2026-09-01T00:00:00.000Z"),
          },
        ]),
        "user_1",
        now
      )
    ).toBe("free");
  });
});

const capturingDb = () => {
  const writes = {
    channels: [] as Array<{
      channelType: string;
      limits: unknown;
      userId: string;
    }>,
    user: undefined as
      | {
          limitOrganizations: number | null;
          limitRetention: number | null;
        }
      | undefined,
  };

  const tx = {
    insert: () => ({
      values: (row: {
        channelType: string;
        limits: unknown;
        userId: string;
      }) => ({
        onConflictDoUpdate: () => {
          writes.channels.push(row);
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (values: {
        limitOrganizations: number | null;
        limitRetention: number | null;
      }) => ({
        where: () => {
          writes.user = values;
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    db: {
      transaction: (fn: (executor: typeof tx) => Promise<void>) => fn(tx),
    } as unknown as PromiseDb,
    writes,
  };
};

describe("ensureUserLimits", () => {
  test("writes unlimited entitlements for self-hosted users", async () => {
    const { db, writes } = capturingDb();

    await ensureUserLimits(db, { selfHosted: true, userId: "user_1" });

    expect(writes.user).toEqual({
      limitOrganizations: null,
      limitRetention: null,
    });
    expect(writes.channels).toEqual([
      {
        userId: "user_1",
        channelType: "email",
        limits: {
          byoProviders: true,
          customDomains: null,
          transactional: {
            managed: { monthlySends: null, dailySends: null },
            byo: { monthlySends: null, dailySends: null },
          },
          marketing: {
            managed: { monthlySends: null, dailySends: null },
            byo: { monthlySends: null, dailySends: null },
          },
        },
      },
    ]);
  });

  test("writes Signal caps for a paid Signal user", async () => {
    const { db, writes } = capturingDb();

    await ensureUserLimits(db, { planName: "signal", userId: "user_1" });

    expect(writes.user).toEqual({
      limitOrganizations: 3,
      limitRetention: 30,
    });
    expect(writes.channels[0]?.limits).toEqual(SIGNAL_LIMITS.email);
  });

  test("writes free caps when the plan name is omitted", async () => {
    const { db, writes } = capturingDb();

    await ensureUserLimits(db, { userId: "user_1" });

    expect(writes.user).toEqual({
      limitOrganizations: 1,
      limitRetention: 7,
    });
    expect(writes.channels[0]?.limits).toEqual(FREE_LIMITS.email);
  });
});

const sessionDb = (
  subscriptions: ReadonlyArray<{
    periodEnd: Date | null;
    periodStart: Date | null;
    plan: string;
    status: string;
  }>
) => {
  const captured = capturingDb();
  const subscriptionsDb = dbWithSubscriptions(subscriptions);

  return {
    db: {
      query: subscriptionsDb.query,
      transaction: captured.db.transaction,
    } as unknown as PromiseDb,
    writes: captured.writes,
  };
};

describe("syncSessionUserLimits", () => {
  test("writes unlimited entitlements when Stripe is not configured", async () => {
    const { db, writes } = sessionDb([]);

    await syncSessionUserLimits(db, {
      stripeConfigured: false,
      userId: "user_1",
    });

    expect(writes.user).toEqual({
      limitOrganizations: null,
      limitRetention: null,
    });
  });

  test("keeps a paid user's plan when Stripe is configured", async () => {
    const now = new Date("2026-08-14T00:00:00.000Z");
    const { db, writes } = sessionDb([
      {
        plan: "signal",
        status: "active",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      },
    ]);

    await syncSessionUserLimits(db, {
      now,
      stripeConfigured: true,
      userId: "user_1",
    });

    expect(writes.user).toEqual({
      limitOrganizations: 3,
      limitRetention: 30,
    });
  });

  test("writes free caps when Stripe is configured and the user has no plan", async () => {
    const { db, writes } = sessionDb([]);

    await syncSessionUserLimits(db, {
      stripeConfigured: true,
      userId: "user_1",
    });

    expect(writes.user).toEqual({
      limitOrganizations: 1,
      limitRetention: 7,
    });
  });
});
