import { describe, expect, it, test } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { Client } from "pg";
import { createPromiseDb } from "../promise";
import { user } from "../schema";
import { DB, makeDbLive } from "./index";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName = "a timestamp reads back as the instant written, whatever the session time zone";
const defaultZoneTestName =
  "a time Postgres fills with now() is on the app's clock, where the database keeps another zone";

const admin = (databaseUrl: string, text: string) =>
  Effect.promise(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(text);
    } finally {
      await client.end();
    }
  });

// Our columns are `timestamp` without time zone, written and read as UTC. The driver and
// Drizzle's codecs between them decide how a Date crosses the wire, so a change to either
// can shift every stored time by the session's offset without a type error.
describe("timestamp columns", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping timestamp integration test: TEST_DATABASE_URL is not set");
    test.skip(testName, () => undefined);
    test.skip(defaultZoneTestName, () => undefined);
    return;
  }

  // #167. The app compares a `created_at` Postgres filled with `now()` against cutoffs from
  // its own clock, written in UTC (a Delivery's age, in `dueBefore`). A session left in the
  // database's zone, twelve hours behind UTC here, would write that `now()` twelve hours
  // back, and a Delivery accepted this minute would read as half a day old.
  it.live(defaultZoneTestName, () =>
    Effect.gen(function* () {
      const name = `timezone_test_${Bun.randomUUIDv7().replaceAll("-", "")}`;
      const url = new URL(testDatabaseUrl);
      url.pathname = `/${name}`;
      yield* Effect.acquireRelease(admin(testDatabaseUrl, `create database "${name}"`), () =>
        admin(testDatabaseUrl, `drop database "${name}" with (force)`),
      );
      yield* admin(testDatabaseUrl, `alter database "${name}" set timezone = 'Etc/GMT+12'`);
      yield* admin(
        url.href,
        "create table accepted (via text primary key, created_at timestamp default now() not null)",
      );

      // What each pool's session reads for a row it has just had Postgres date: its zone,
      // and whether the row is within the hour either side of the app's clock.
      const read = (via: string) => {
        const hourBefore = new Date(Date.now() - 3_600_000).toISOString();
        const hourAfter = new Date(Date.now() + 3_600_000).toISOString();
        return sql<{ now: boolean; zone: string }>`
          with written as (insert into accepted (via) values (${via}) returning created_at)
          select current_setting('TimeZone') as zone,
            created_at > ${hourBefore} and created_at < ${hourAfter} as now
          from written`;
      };

      const effect = yield* Effect.gen(function* () {
        const db = yield* DB;
        return yield* db.execute(read("effect"));
      }).pipe(Effect.provide(makeDbLive({ databaseUrl: url.href })));
      expect(effect.rows).toEqual([{ now: true, zone: "UTC" }]);

      const promiseDb = yield* Effect.acquireRelease(
        Effect.sync(() => createPromiseDb({ databaseUrl: url.href })),
        (db) => Effect.promise(() => db.$client.end()),
      );
      const promise = yield* Effect.promise(() => promiseDb.execute(read("promise")));
      // One statement, so one result, whichever of its two shapes `execute` is typed as.
      expect([promise].flat().map((result) => result.rows)).toEqual([[{ now: true, zone: "UTC" }]]);

      // The database's own zone is what a session gets when nothing sets it.
      const unset = yield* Effect.promise(async () => {
        const client = new Client({ connectionString: url.href });
        await client.connect();
        try {
          return (await client.query("select current_setting('TimeZone') as zone")).rows;
        } finally {
          await client.end();
        }
      });
      expect(unset).toEqual([{ zone: "Etc/GMT+12" }]);
    }).pipe(Effect.scoped),
  );

  it.live(testName, () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const written = new Date("2026-03-04T05:06:07.890Z");

      for (const zone of ["UTC", "Pacific/Auckland"]) {
        const email = `timestamps-${zone}-${Bun.randomUUIDv7()}@example.test`;
        const read = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.execute(sql.raw(`set local time zone '${zone}'`));
            const [returned] = yield* tx
              .insert(user)
              .values({ createdAt: written, email, name: zone, updatedAt: written })
              .returning({ createdAt: user.createdAt });
            const [selected] = yield* tx
              .select({ createdAt: user.createdAt })
              .from(user)
              .where(eq(user.email, email));
            const related = yield* tx.query.user.findFirst({ where: { email } });
            const [text] = yield* tx
              .select({ createdAt: sql<string>`${user.createdAt}::text` })
              .from(user)
              .where(eq(user.email, email));
            return { related, returned, selected, text };
          }),
        );

        expect(read.returned?.createdAt.toISOString()).toBe(written.toISOString());
        expect(read.selected?.createdAt.toISOString()).toBe(written.toISOString());
        expect(read.related?.createdAt.toISOString()).toBe(written.toISOString());
        expect(read.text?.createdAt).toBe("2026-03-04 05:06:07.89");
      }
    }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl }))),
  );
});
