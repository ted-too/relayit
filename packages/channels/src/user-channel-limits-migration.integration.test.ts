/**
 * The migration that drops the `managed` level from `user_channel.limits` (#34), run from
 * its own file against rows in every shape the plans code has written and a few it never
 * did, together with the statements its rollout relies on: the checks for rows the Usage
 * policy refuses, before and after, and the reverse of the migration. A cap that changes here changes
 * what a billing user may send.
 *
 * One-off: delete this file when `user_channel.limits` next changes shape.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import { type DatabaseExecutor, DB, makeDbLive } from "@repo/persistence/db/effect";
import { user, userChannel } from "@repo/persistence/db/schema";
import { inArray, sql } from "drizzle-orm";
import { Effect, Layer, Result } from "effect";
import { UsagePolicy, UsagePolicyLive } from "./usage-policy";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

const drizzleFolder = NodePath.join(import.meta.dirname, "../../persistence/drizzle");

/**
 * Lists every row the Usage policy refuses for either purpose: each purpose must hold both
 * caps, each null or a whole number from 0 up to the largest a double holds exactly.
 */
const REFUSED_ROWS = `
SELECT user_id, limits FROM user_channel
WHERE NOT COALESCE((SELECT bool_and(COALESCE(
    jsonb_typeof(limits->p->c) = 'null'
    OR (jsonb_typeof(limits->p->c) = 'number'
        AND (limits->p->>c)::numeric BETWEEN 0 AND 9007199254740991
        AND (limits->p->>c)::numeric = trunc((limits->p->>c)::numeric)), false))
  FROM unnest(array['transactional','marketing']) p, unnest(array['dailySends','monthlySends']) c), false)`;

/**
 * The same check on each row as the migration will leave it, to run before deploying:
 * until the migration has run, every row still holds `managed` and the check above lists
 * them all.
 */
const REFUSED_ONCE_MIGRATED = `
SELECT user_id, limits FROM user_channel
WHERE NOT COALESCE((SELECT bool_and(COALESCE(
    jsonb_typeof(b->c) = 'null'
    OR (jsonb_typeof(b->c) = 'number'
        AND (b->>c)::numeric BETWEEN 0 AND 9007199254740991
        AND (b->>c)::numeric = trunc((b->>c)::numeric)), false))
  FROM unnest(array['transactional','marketing']) p,
    LATERAL (SELECT CASE WHEN jsonb_typeof(limits->p->'managed') = 'object'
        AND limits->p->'managed' ?& array['dailySends','monthlySends']
      THEN limits->p->'managed' ELSE limits->p END AS b) bucket,
    unnest(array['dailySends','monthlySends']) c), false)`;

/** Puts flat purposes back under `managed`, for the release before this one. */
const REVERSE = `
UPDATE user_channel SET limits = limits
  || CASE WHEN jsonb_typeof(limits->'transactional')='object' AND NOT (limits->'transactional' ? 'managed')
     THEN jsonb_build_object('transactional', jsonb_build_object('managed', limits->'transactional')) ELSE '{}'::jsonb END
  || CASE WHEN jsonb_typeof(limits->'marketing')='object' AND NOT (limits->'marketing' ? 'managed')
     THEN jsonb_build_object('marketing', jsonb_build_object('managed', limits->'marketing')) ELSE '{}'::jsonb END
WHERE (jsonb_typeof(limits->'transactional')='object' AND NOT (limits->'transactional' ? 'managed'))
   OR (jsonb_typeof(limits->'marketing')='object' AND NOT (limits->'marketing' ? 'managed'))`;

const UNLIMITED = { dailySends: null, monthlySends: null };

/**
 * Each row as it was stored and as the migration must leave it. `reversed` is what the
 * reverse statement then makes of it, where that is not `before`.
 */
const rows: readonly {
  readonly after: unknown;
  readonly before: unknown;
  readonly name: string;
  readonly reversed?: unknown;
}[] = [
  {
    name: "free",
    before: {
      customDomains: 1,
      transactional: { managed: { monthlySends: 2500, dailySends: 80 } },
      marketing: { managed: { monthlySends: 500, dailySends: 20 } },
    },
    after: {
      customDomains: 1,
      transactional: { monthlySends: 2500, dailySends: 80 },
      marketing: { monthlySends: 500, dailySends: 20 },
    },
  },
  {
    name: "signal",
    before: {
      customDomains: null,
      transactional: { managed: { monthlySends: 40_000, dailySends: null } },
      marketing: { managed: { monthlySends: 10_000, dailySends: null } },
    },
    after: {
      customDomains: null,
      transactional: { monthlySends: 40_000, dailySends: null },
      marketing: { monthlySends: 10_000, dailySends: null },
    },
  },
  {
    name: "broadcast",
    before: {
      customDomains: null,
      transactional: { managed: { monthlySends: 200_000, dailySends: null } },
      marketing: { managed: { monthlySends: 50_000, dailySends: null } },
    },
    after: {
      customDomains: null,
      transactional: { monthlySends: 200_000, dailySends: null },
      marketing: { monthlySends: 50_000, dailySends: null },
    },
  },
  {
    name: "self-hosted, unlimited",
    before: {
      customDomains: null,
      transactional: { managed: UNLIMITED },
      marketing: { managed: UNLIMITED },
    },
    after: { customDomains: null, transactional: UNLIMITED, marketing: UNLIMITED },
  },
  {
    // Written before BYO Providers were removed (#33) by a user who hasn't signed in since.
    name: "free, with the BYO buckets",
    before: {
      byoProviders: false,
      customDomains: 1,
      transactional: {
        managed: { monthlySends: 2500, dailySends: 80 },
        byo: { monthlySends: 10_000, dailySends: 500 },
      },
      marketing: {
        managed: { monthlySends: 500, dailySends: 20 },
        byo: { monthlySends: 2000, dailySends: 100 },
      },
    },
    after: {
      byoProviders: false,
      customDomains: 1,
      transactional: { monthlySends: 2500, dailySends: 80 },
      marketing: { monthlySends: 500, dailySends: 20 },
    },
    // The BYO buckets are gone for good; nothing has read them since #33.
    reversed: {
      byoProviders: false,
      customDomains: 1,
      transactional: { managed: { monthlySends: 2500, dailySends: 80 } },
      marketing: { managed: { monthlySends: 500, dailySends: 20 } },
    },
  },
  {
    name: "one purpose only",
    before: { customDomains: null, transactional: { managed: { monthlySends: 7, dailySends: 3 } } },
    after: { customDomains: null, transactional: { monthlySends: 7, dailySends: 3 } },
  },
  {
    // The old reader took an absent cap for unlimited. The migration doesn't store that
    // accident as a decision: the bucket stays, and the Usage policy refuses it.
    name: "caps absent from the bucket",
    before: { transactional: { managed: { monthlySends: 100 } }, marketing: { managed: {} } },
    after: { transactional: { managed: { monthlySends: 100 } }, marketing: { managed: {} } },
  },
  {
    name: "one purpose whole, the other missing a cap",
    before: {
      transactional: { managed: { monthlySends: 2500, dailySends: 80 } },
      marketing: { managed: { dailySends: 20 } },
    },
    after: {
      transactional: { monthlySends: 2500, dailySends: 80 },
      marketing: { managed: { dailySends: 20 } },
    },
  },
  {
    name: "one purpose already flat",
    before: {
      customDomains: 1,
      transactional: { monthlySends: 2500, dailySends: 80 },
      marketing: { managed: { monthlySends: 500, dailySends: 20 } },
    },
    after: {
      customDomains: 1,
      transactional: { monthlySends: 2500, dailySends: 80 },
      marketing: { monthlySends: 500, dailySends: 20 },
    },
    reversed: {
      customDomains: 1,
      transactional: { managed: { monthlySends: 2500, dailySends: 80 } },
      marketing: { managed: { monthlySends: 500, dailySends: 20 } },
    },
  },
  {
    // No caps to carry over: left as it is, never rewritten into an unlimited bucket.
    name: "a managed level that holds no bucket",
    before: { transactional: { managed: null }, marketing: "managed" },
    after: { transactional: { managed: null }, marketing: "managed" },
  },
];

/** Shapes no migration produces, for the check's agreement with the Usage policy. */
const strays: readonly unknown[] = [
  { transactional: UNLIMITED, marketing: { dailySends: -1, monthlySends: 500 } },
  { transactional: { dailySends: 2.5, monthlySends: 500 }, marketing: UNLIMITED },
  { transactional: { dailySends: "80", monthlySends: 500 }, marketing: UNLIMITED },
  { transactional: { dailySends: true, monthlySends: 500 }, marketing: UNLIMITED },
  { transactional: { dailySends: 0, monthlySends: 1e3 }, marketing: UNLIMITED },
  { transactional: { dailySends: 9_007_199_254_740_991, monthlySends: 1 }, marketing: UNLIMITED },
  // One past the largest whole number a double holds exactly.
  { transactional: { dailySends: 9_007_199_254_740_992, monthlySends: 1 }, marketing: UNLIMITED },
  { transactional: [UNLIMITED], marketing: UNLIMITED },
  [{ transactional: UNLIMITED, marketing: UNLIMITED }],
  "managed",
  null,
];

/** Stores each of `limits` as one new billing user's email limits, as given. */
const store = (db: DatabaseExecutor, limits: readonly unknown[]) =>
  Effect.gen(function* () {
    const run = Bun.randomUUIDv7();
    const userIds = limits.map((_, index) => `user_limits_${run}_${index}`);
    yield* db
      .insert(user)
      .values(userIds.map((id) => ({ email: `${id}@example.test`, id, name: "Limits" })));
    for (const [index, value] of limits.entries()) {
      // Raw, because the column's type admits only the shape the plans code writes now.
      yield* db.execute(
        sql`insert into "user_channel" ("user_id", "channel_type", "limits", "updated_at")
            values (${userIds[index]}, 'email', ${JSON.stringify(value)}::jsonb, now())`,
      );
    }
    return userIds;
  });

describe("the migration flattening user_channel.limits", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping limits migration tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL tests are opt-in.
    test.skip("flattens every old shape and keeps every cap", () => undefined);
    return;
  }

  const live = UsagePolicyLive.pipe(
    Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })),
  );

  it.live("flattens every old shape, keeps every cap, runs again unchanged, and reverses", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const folder = NodeFS.readdirSync(drizzleFolder).find((name) =>
        name.endsWith("_flatten_user_channel_limits"),
      );
      const migration = NodeFS.readFileSync(
        NodePath.join(drizzleFolder, folder ?? "", "migration.sql"),
        "utf8",
      );

      // Both statements rewrite the whole table, which other tests are using: rolled back,
      // they never see it.
      const seen = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const userIds = yield* store(
              tx,
              rows.map((row) => row.before),
            );
            const stored = Effect.map(
              tx
                .select({ limits: userChannel.limits, userId: userChannel.userId })
                .from(userChannel)
                .where(inArray(userChannel.userId, userIds)),
              (found) => userIds.map((id) => found.find((row) => row.userId === id)?.limits),
            );

            yield* tx.execute(sql.raw(migration));
            const migrated = yield* stored;
            yield* tx.execute(sql.raw(migration));
            const migratedAgain = yield* stored;
            yield* tx.execute(sql.raw(REVERSE));
            const reversed = yield* stored;
            yield* tx.execute(sql.raw(REVERSE));
            const reversedAgain = yield* stored;
            return yield* Effect.fail({ migrated, migratedAgain, reversed, reversedAgain });
          }),
        )
        .pipe(Effect.flip);

      const after = rows.map((row) => row.after);
      const before = rows.map((row) => row.reversed ?? row.before);
      expect(seen).toEqual({
        migrated: after,
        migratedAgain: after,
        reversed: before,
        reversedAgain: before,
      });
    }).pipe(Effect.provide(live)),
  );

  it.live("the check for refused rows lists exactly the rows the Usage policy refuses", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const policies = yield* UsagePolicy;
      const limits = [...rows.flatMap((row) => [row.before, row.after]), ...strays];
      const userIds = yield* store(db, limits);

      const listed = new Set(
        (yield* db.execute<{ user_id: string }>(sql.raw(REFUSED_ROWS))).rows.map(
          (row) => row.user_id,
        ),
      );
      const verdicts = yield* Effect.forEach(userIds, (userId, index) =>
        Effect.gen(function* () {
          const answers = yield* Effect.forEach(
            ["transactional", "marketing"] as const,
            (purpose) =>
              Effect.result(
                policies.resolve({
                  billingUserId: userId,
                  channel: "email",
                  organizationId: "orgn_unused",
                  purpose,
                  reservedAt: new Date().toISOString(),
                }),
              ),
          );
          return {
            limits: limits[index],
            listed: listed.has(userId),
            refused: answers.some(Result.isFailure),
          };
        }),
      );

      expect(verdicts.filter((verdict) => verdict.listed !== verdict.refused)).toEqual([]);

      // Before the migration, the forecast for a row is the verdict on what it becomes.
      const forecast = new Set(
        (yield* db.execute<{ user_id: string }>(sql.raw(REFUSED_ONCE_MIGRATED))).rows.map(
          (row) => row.user_id,
        ),
      );
      expect(
        rows.map((row, index) => ({
          forecast: forecast.has(userIds[index * 2] ?? ""),
          name: row.name,
        })),
      ).toEqual(
        rows.map((row, index) => ({ forecast: verdicts[index * 2 + 1]?.refused, name: row.name })),
      );
      // Not vacuous: the migrated Plan rows pass, the unmigrated ones don't.
      expect(verdicts.filter((verdict) => verdict.refused).length).toBeGreaterThan(rows.length);
      expect(verdicts.filter((verdict) => !verdict.refused).length).toBeGreaterThan(5);
    }).pipe(Effect.provide(live)),
  );
});
