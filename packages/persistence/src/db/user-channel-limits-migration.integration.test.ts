/**
 * The migration that drops the `managed` level from `user_channel.limits` (#34), run from
 * its own file against rows in every shape the plans code has written, and a few it never
 * did. A cap that changes here changes what a billing user may send.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import { inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DB, makeDbLive } from "./effect";
import { user, userChannel } from "./schema";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName = "flattens every old shape, keeps every cap, and changes nothing when run again";

const drizzleFolder = NodePath.join(import.meta.dirname, "../../drizzle");

const UNLIMITED = { dailySends: null, monthlySends: null };

// Each row as it was stored, and as the migration must leave it.
const rows = [
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
  },
  {
    name: "one purpose only",
    before: { customDomains: null, transactional: { managed: { monthlySends: 7, dailySends: 3 } } },
    after: { customDomains: null, transactional: { monthlySends: 7, dailySends: 3 } },
  },
  {
    // The old reader took an absent cap for unlimited; the new one requires the key.
    name: "caps absent from the bucket",
    before: { transactional: { managed: { monthlySends: 100 } }, marketing: { managed: {} } },
    after: { transactional: { monthlySends: 100, dailySends: null }, marketing: UNLIMITED },
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
  },
  {
    name: "already flat",
    before: {
      customDomains: 1,
      transactional: { monthlySends: 2500, dailySends: 80 },
      marketing: { monthlySends: 500, dailySends: 20 },
    },
    after: {
      customDomains: 1,
      transactional: { monthlySends: 2500, dailySends: 80 },
      marketing: { monthlySends: 500, dailySends: 20 },
    },
  },
  {
    // No caps to carry over: left as it is, never rewritten into an unlimited bucket.
    name: "a managed level that holds no bucket",
    before: { transactional: { managed: null }, marketing: "managed" },
    after: { transactional: { managed: null }, marketing: "managed" },
  },
];

describe("the migration flattening user_channel.limits", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping limits migration test: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  it.live(testName, () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const folder = NodeFS.readdirSync(drizzleFolder).find((name) =>
        name.endsWith("_flatten_user_channel_limits"),
      );
      const migration = NodeFS.readFileSync(
        NodePath.join(drizzleFolder, folder ?? "", "migration.sql"),
        "utf8",
      );

      const run = Bun.randomUUIDv7();
      const userIds = rows.map((_, index) => `user_limits_${run}_${index}`);
      yield* db
        .insert(user)
        .values(
          userIds.map((id) => ({ email: `${id}@example.test`, id, name: "Limits migration" })),
        );
      for (const [index, row] of rows.entries()) {
        // Raw, because the column's type no longer admits the old shapes.
        yield* db.execute(
          sql`insert into "user_channel" ("user_id", "channel_type", "limits", "updated_at")
              values (${userIds[index]}, 'email', ${JSON.stringify(row.before)}::jsonb, now())`,
        );
      }

      const stored = Effect.map(
        db
          .select({ limits: userChannel.limits, userId: userChannel.userId })
          .from(userChannel)
          .where(inArray(userChannel.userId, userIds)),
        (found) => userIds.map((id) => found.find((row) => row.userId === id)?.limits),
      );
      const expected = rows.map((row) => row.after);

      yield* db.execute(sql.raw(migration));
      expect(yield* stored).toEqual(expected);

      yield* db.execute(sql.raw(migration));
      expect(yield* stored).toEqual(expected);
    }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl }))),
  );
});
