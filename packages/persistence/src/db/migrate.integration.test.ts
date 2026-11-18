import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { Client } from "pg";
import { DatabaseBehindError, migrateDatabase, requireMigrated } from "./migrate";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

const carried = NodeFS.readdirSync(NodePath.join(import.meta.dirname, "../../drizzle")).toSorted();

const query = (databaseUrl: string, text: string) =>
  Effect.promise(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      return (await client.query<Record<string, string>>(text)).rows;
    } finally {
      await client.end();
    }
  });

/** A database of this test's own on the run's Postgres: the shared one is already migrated. */
const emptyDatabase = (serverUrl: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const name = `migrate_test_${Bun.randomUUIDv7().replaceAll("-", "")}`;
      yield* query(serverUrl, `create database "${name}"`);
      const url = new URL(serverUrl);
      url.pathname = `/${name}`;
      return { name, url: url.href };
    }),
    ({ name }) => query(serverUrl, `drop database "${name}" with (force)`),
  ).pipe(Effect.map(({ url }) => url));

const applied = (databaseUrl: string) =>
  query(databaseUrl, "select name from drizzle.__drizzle_migrations order by name").pipe(
    Effect.map((rows) => rows.map((row) => row.name)),
  );

describe("the migrate step and the apps' check for it", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping migrate integration tests: TEST_DATABASE_URL is not set");
    test.skip("migrates an empty database once", () => undefined);
    return;
  }

  it.live("two steps at once migrate an empty database once, and a later one changes nothing", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);

      yield* Effect.promise(() =>
        Promise.all([migrateDatabase(databaseUrl), migrateDatabase(databaseUrl)]),
      );
      expect(yield* applied(databaseUrl)).toEqual(carried);

      yield* Effect.promise(() => migrateDatabase(databaseUrl));
      expect(yield* applied(databaseUrl)).toEqual(carried);
      yield* requireMigrated({ databaseUrl, waitFor: 0 });
    }).pipe(Effect.scoped),
  );

  it.live("the step rejects when it cannot migrate", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      // The first migration creates this type, so it fails and the whole run rolls back.
      yield* query(databaseUrl, `create type "channel" as enum ('taken')`);

      const outcome = yield* Effect.tryPromise(() => migrateDatabase(databaseUrl)).pipe(
        Effect.exit,
      );
      expect(outcome._tag).toBe("Failure");
      expect(yield* applied(databaseUrl)).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("an app refuses a database that was never migrated, or lacks its newest migration", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);

      const never = yield* requireMigrated({ databaseUrl, waitFor: 0 }).pipe(Effect.flip);
      expect(never).toBeInstanceOf(DatabaseBehindError);
      expect(never.missing).toEqual(carried);

      yield* Effect.promise(() => migrateDatabase(databaseUrl));
      const newest = carried.at(-1);
      yield* query(
        databaseUrl,
        `delete from drizzle.__drizzle_migrations where name = '${newest}'`,
      );
      const behind = yield* requireMigrated({ databaseUrl, waitFor: 0 }).pipe(Effect.flip);
      expect(behind.missing).toEqual([newest]);
    }).pipe(Effect.scoped),
  );

  it.live("an app starts against a database a newer release has already migrated", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      yield* Effect.promise(() => migrateDatabase(databaseUrl));
      yield* query(
        databaseUrl,
        `insert into drizzle.__drizzle_migrations (hash, created_at, name)
         values ('newer', 99990101000000, '99990101000000_from_a_newer_release')`,
      );

      yield* requireMigrated({ databaseUrl, waitFor: 0 });
    }).pipe(Effect.scoped),
  );

  it.live("an app started before the step has finished waits for it, then starts", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);

      const app = yield* Effect.forkChild(requireMigrated({ databaseUrl, waitFor: "30 seconds" }));
      yield* Effect.sleep("500 millis");
      expect(app.pollUnsafe()).toBeUndefined();

      yield* Effect.promise(() => migrateDatabase(databaseUrl));
      yield* Fiber.join(app);
    }).pipe(Effect.scoped),
  );
});
