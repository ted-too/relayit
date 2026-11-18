/**
 * What the Usage policy makes of a `user_channel.limits` row. A row it cannot read as caps
 * must fail the send: read loosely, a missing cap is no cap, and a capped billing user
 * sends without limit.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { user } from "@repo/persistence/db/schema";
import { sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { UsagePolicy, UsagePolicyLive } from "./usage-policy";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

/** A billing user whose email limits are `limits`, stored as given, and their policy. */
const resolveWith = (limits: unknown, purpose: "marketing" | "transactional" = "transactional") =>
  Effect.gen(function* () {
    const db = yield* DB;
    const policies = yield* UsagePolicy;
    const userId = `user_policy_${Bun.randomUUIDv7()}`;
    yield* db.insert(user).values({ email: `${userId}@example.test`, id: userId, name: "Policy" });
    // Raw, because the column's type admits only the shape the plans code writes.
    yield* db.execute(
      sql`insert into "user_channel" ("user_id", "channel_type", "limits", "updated_at")
          values (${userId}, 'email', ${JSON.stringify(limits)}::jsonb, now())`,
    );
    return yield* policies.resolve({
      billingUserId: userId,
      channel: "email",
      organizationId: "orgn_unused",
      purpose,
      reservedAt: new Date().toISOString(),
    });
  });

describe("the Usage policy reading user_channel.limits", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Usage policy tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL tests are opt-in.
    test.skip("reads a purpose's caps and refuses any other shape", () => undefined);
    return;
  }

  const live = UsagePolicyLive.pipe(
    Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })),
  );

  it.live("reads each purpose's caps, null meaning unlimited", () =>
    Effect.gen(function* () {
      const limits = {
        customDomains: 1,
        marketing: { dailySends: 20, monthlySends: 500 },
        transactional: { dailySends: null, monthlySends: 2500 },
      };
      expect(yield* resolveWith(limits)).toMatchObject({ dailyLimit: null, monthlyLimit: 2500 });
      expect(yield* resolveWith(limits, "marketing")).toMatchObject({
        dailyLimit: 20,
        monthlyLimit: 500,
      });
    }).pipe(Effect.provide(live)),
  );

  it.live("reads the one purpose a row holds and refuses the one it lacks", () =>
    Effect.gen(function* () {
      const limits = { transactional: { dailySends: 3, monthlySends: 7 } };
      expect(yield* resolveWith(limits)).toMatchObject({ dailyLimit: 3, monthlyLimit: 7 });
      expect(yield* Effect.flip(resolveWith(limits, "marketing"))).toMatchObject({
        code: "channel_limits_invalid",
      });
    }).pipe(Effect.provide(live)),
  );

  it.live.each([
    [
      "the managed level #34 dropped",
      { transactional: { managed: { dailySends: 80, monthlySends: 2500 } } },
    ],
    ["a cap missing", { transactional: { monthlySends: 2500 } }],
    ["a negative cap", { transactional: { dailySends: -1, monthlySends: 2500 } }],
    ["a cap that is not a number", { transactional: { dailySends: "80", monthlySends: 2500 } }],
    ["a purpose that is not an object", { transactional: null }],
    ["limits that are not an object", null],
  ])("refuses %s rather than reading it as uncapped", ([, limits]) =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(resolveWith(limits))).toMatchObject({
        _tag: "UsagePolicyError",
        code: "channel_limits_invalid",
      });
    }).pipe(Effect.provide(live)),
  );
});
