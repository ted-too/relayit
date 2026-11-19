import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { Client } from "pg";
import {
  DatabaseBehindError,
  DatabaseUnreachableError,
  migrateDatabase,
  MigrationError,
  requireMigrated,
} from "./migrate";

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

      yield* Effect.all(
        [
          migrateDatabase({ databaseUrl, waitFor: 0 }),
          migrateDatabase({ databaseUrl, waitFor: 0 }),
        ],
        { concurrency: "unbounded" },
      );
      expect(yield* applied(databaseUrl)).toEqual(carried);

      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      expect(yield* applied(databaseUrl)).toEqual(carried);
      yield* requireMigrated({ databaseUrl, waitFor: 0 });
    }).pipe(Effect.scoped),
  );

  it.live("the step fails when it cannot migrate, without trying again", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      // The first migration creates this type, so it fails and the whole run rolls back.
      yield* query(databaseUrl, `create type "channel" as enum ('taken')`);

      const started = Date.now();
      const error = yield* migrateDatabase({ databaseUrl, waitFor: "30 seconds" }).pipe(
        Effect.flip,
      );
      expect(error).toBeInstanceOf(MigrationError);
      // The wait is for a connection only: a second attempt would come two seconds later.
      expect(Date.now() - started).toBeLessThan(2000);
      expect(yield* applied(databaseUrl)).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.live("the step started before its database takes connections waits, then migrates it", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      const name = new URL(databaseUrl).pathname.slice(1);
      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections false`);

      const step = yield* Effect.forkChild(migrateDatabase({ databaseUrl, waitFor: "30 seconds" }));
      yield* Effect.sleep("500 millis");
      expect(step.pollUnsafe()).toBeUndefined();

      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections true`);
      yield* Fiber.join(step);
      expect(yield* applied(databaseUrl)).toEqual(carried);
    }).pipe(Effect.scoped),
  );

  it.live(
    "the step whose database never takes connections fails with why, once its wait is over",
    () =>
      Effect.gen(function* () {
        const started = Date.now();
        // Nothing listens on port 1.
        const error = yield* migrateDatabase({
          databaseUrl: "postgres://postgres:postgres@127.0.0.1:1/relayit",
          waitFor: "1 second",
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(DatabaseUnreachableError);
        expect(error).toMatchObject({ cause: { code: "ECONNREFUSED" } });
        // Not at the first refusal: it tried again two seconds later.
        expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
      }),
  );

  it.live("an app refuses a database that was never migrated, or lacks its newest migration", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);

      const never = yield* requireMigrated({ databaseUrl, waitFor: 0 }).pipe(Effect.flip);
      expect(never).toBeInstanceOf(DatabaseBehindError);
      expect(never).toMatchObject({ missing: carried });

      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      const newest = carried.at(-1);
      yield* query(
        databaseUrl,
        `delete from drizzle.__drizzle_migrations where name = '${newest}'`,
      );
      const behind = yield* requireMigrated({ databaseUrl, waitFor: 0 }).pipe(Effect.flip);
      expect(behind).toMatchObject({ missing: [newest] });
    }).pipe(Effect.scoped),
  );

  it.live("an app starts against a database a newer release has already migrated", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
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

      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      yield* Fiber.join(app);
    }).pipe(Effect.scoped),
  );

  it.live("an app started before its database takes connections waits, then starts", () =>
    Effect.gen(function* () {
      const databaseUrl = yield* emptyDatabase(testDatabaseUrl);
      const name = new URL(databaseUrl).pathname.slice(1);
      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections false`);
      // Refused, not merely behind: an empty database would keep the app waiting too.
      const refused = yield* Effect.tryPromise(() =>
        new Client({ connectionString: databaseUrl }).connect(),
      ).pipe(Effect.flip);
      expect(refused).toMatchObject({ cause: { code: "55000" } });

      const app = yield* Effect.forkChild(requireMigrated({ databaseUrl, waitFor: "30 seconds" }));
      yield* Effect.sleep("500 millis");
      expect(app.pollUnsafe()).toBeUndefined();

      yield* query(testDatabaseUrl, `alter database "${name}" allow_connections true`);
      yield* migrateDatabase({ databaseUrl, waitFor: 0 });
      yield* Fiber.join(app);
    }).pipe(Effect.scoped),
  );

  it.live(
    "an app whose database never takes connections fails with why, once its wait is over",
    () =>
      Effect.gen(function* () {
        const started = Date.now();
        // Nothing listens on port 1.
        const error = yield* requireMigrated({
          databaseUrl: "postgres://postgres:postgres@127.0.0.1:1/relayit",
          waitFor: "1 second",
        }).pipe(Effect.flip);

        expect(error).toBeInstanceOf(DatabaseUnreachableError);
        expect(error).toMatchObject({ cause: { code: "ECONNREFUSED" } });
        // Not at the first refusal: it tried again two seconds later.
        expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
      }).pipe(Effect.scoped),
  );
});
