import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Data, type Duration, Effect, Schedule } from "effect";
import { Client } from "pg";

/** Fixed identity — do not change after first deploy. */
const LOCK_KEY1 = 872_014_331;
const LOCK_KEY2 = 1;

/**
 * Source-relative path works for unbundled `bun run`. Bundled images set
 * `DRIZZLE_MIGRATIONS_FOLDER` because `import.meta.url` is the output file.
 */
const resolveMigrationsFolder = (): string => {
  const fromEnv = process.env.DRIZZLE_MIGRATIONS_FOLDER;
  const folder =
    fromEnv !== undefined && fromEnv.length > 0
      ? fromEnv
      : NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../../drizzle");
  if (!NodeFS.existsSync(folder)) {
    throw new Error(`Drizzle migrations folder not found at ${folder}`);
  }
  return folder;
};

export class DatabaseBehindError extends Data.TaggedError("DatabaseBehindError")<{
  /** The migrations this build carries that the database has not had applied. */
  readonly missing: ReadonlyArray<string>;
}> {
  override readonly message =
    "The database is missing migrations this version needs. Run the migrate step first (`bun run migrate.js` in the api image)";
}

/** No connection to the database, or, for an app's check, its query failed. */
export class DatabaseUnreachableError extends Data.TaggedError("DatabaseUnreachableError")<{
  readonly cause: unknown;
}> {
  override readonly message = "Could not reach the database";
}

/** The database was reached and the migrations did not apply; the run rolled back whole. */
export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly cause: unknown;
}> {
  override readonly message = "Could not migrate the database";
}

/**
 * The one wait the migrate step and the apps' check share: try again every two seconds
 * for `waitFor`, one log line with the reason per failed attempt, then fail with the last
 * attempt's error. The wait is counted between attempts, so an attempt must bound itself.
 */
const retryFor =
  (waitFor: Duration.Input) =>
  <A, R>(attempt: Effect.Effect<A, DatabaseBehindError | DatabaseUnreachableError, R>) =>
    attempt.pipe(
      Effect.tapError((error) => {
        switch (error._tag) {
          case "DatabaseBehindError": {
            return Effect.logWarning(
              "Waiting for the migrate step: the database is behind this version",
            ).pipe(Effect.annotateLogs({ missing: error.missing.join(", ") }));
          }
          case "DatabaseUnreachableError": {
            // One line an attempt; the cause in full is in the failure, if it comes to that.
            return Effect.logWarning("Waiting for the database: could not reach it").pipe(
              Effect.annotateLogs({ reason: String(error.cause) }),
            );
          }
        }
      }),
      Effect.retry({
        schedule: Schedule.spaced("2 seconds").pipe(Schedule.upTo({ duration: waitFor })),
      }),
    );

/**
 * Apply pending Drizzle migrations under a Postgres session advisory lock, so concurrent
 * runs are safe: losers wait, then no-op. No app calls this as it starts; a release runs
 * it once, before its apps (docs/operations/deploys.md).
 *
 * Only the connection is retried, for `waitFor`: a Postgres that is still starting, or
 * restarting, should not fail a release that would have gone through seconds later. Once
 * connected, nothing is: a migration that failed will fail again, and a connection lost
 * part-way has rolled the run back, which is for a person to look at.
 */
export const migrateDatabase = (options: {
  readonly databaseUrl: string;
  readonly waitFor: Duration.Input;
}) =>
  Effect.gen(function* () {
    // Read outside the retry: an image without its migrations will not grow them.
    const migrationsFolder = yield* Effect.sync(resolveMigrationsFolder);
    const client = yield* Effect.tryPromise({
      catch: (cause) => new DatabaseUnreachableError({ cause }),
      try: async () => {
        const client = new Client({
          connectionString: options.databaseUrl,
          // An address that answers nothing would otherwise hold one attempt open. No
          // query timeout: the lock is waited for and a migration takes as long as it takes.
          connectionTimeoutMillis: 10_000,
        });
        // pg reports a connection lost between calls as an event, and an error event
        // nobody listens for ends the process before the failure is logged.
        client.on("error", () => undefined);
        try {
          await client.connect();
          return client;
        } catch (error) {
          await client.end().catch(() => undefined);
          throw error;
        }
      },
    }).pipe(retryFor(options.waitFor));
    yield* Effect.tryPromise({
      catch: (cause) => new MigrationError({ cause }),
      try: async () => {
        try {
          await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_KEY1, LOCK_KEY2]);
          try {
            const result = await migrate(drizzle({ client }), { migrationsFolder });
            if (result != null) {
              throw new Error(`Database migration failed with exit code: ${result.exitCode}`);
            }
          } finally {
            await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_KEY1, LOCK_KEY2]);
          }
        } finally {
          // A connection that was lost has nothing to end, and must not hide why.
          await client.end().catch(() => undefined);
        }
      },
    });
  });

/**
 * What an app does before it serves: succeed once the database has every migration this
 * build carries. Until then it checks every two seconds for `waitFor` (five minutes unless
 * given), then fails with the last check's outcome: `DatabaseBehindError`, or
 * `DatabaseUnreachableError` if it could not ask.
 *
 * Behind is refused because the app's queries would fail one by one. It waits rather than
 * exiting at once because a platform that starts services in no order (Railway) may start
 * this one while the release's migrate step is still running. A database it cannot reach
 * gets the same wait, whatever the reason: Postgres still starting or a dropped connection
 * passes, and exiting costs a restart, of which a platform allows only so many. A database
 * that is ahead, with migrations this build has never heard of, is fine: during a rollout
 * the previous version keeps running against the schema the new one migrated, so a
 * migration must always leave the previous release working.
 */
export const requireMigrated = (options: {
  readonly databaseUrl: string;
  readonly waitFor?: Duration.Input;
}) =>
  Effect.gen(function* () {
    // Drizzle decides what to run by name, so the same comparison says what is missing.
    // Read outside the retry: an image without its migrations will not grow them.
    const carried = yield* Effect.sync(() =>
      readMigrationFiles({ migrationsFolder: resolveMigrationsFolder() }),
    );
    return yield* Effect.tryPromise({
      catch: (cause) => new DatabaseUnreachableError({ cause }),
      try: async () => {
        const client = new Client({
          connectionString: options.databaseUrl,
          // An address that answers nothing, or a connection that goes quiet after it is
          // made, would otherwise hold one attempt open, and the wait is only counted
          // between attempts.
          connectionTimeoutMillis: 10_000,
          query_timeout: 10_000,
        });
        // pg reports a connection lost between calls as an event, and an error event
        // nobody listens for ends the process.
        client.on("error", () => undefined);
        try {
          await client.connect();
          const applied = await client
            .query<{ name: string | null }>("select name from drizzle.__drizzle_migrations")
            .then(
              (result) => new Set(result.rows.map((row) => row.name)),
              (error: { readonly code?: string }) => {
                // undefined_table: nothing has ever migrated this database.
                if (error.code === "42P01") {
                  return new Set<string | null>();
                }
                throw error;
              },
            );
          return carried.map((migration) => migration.name).filter((name) => !applied.has(name));
        } finally {
          // A client that never connected has nothing to end.
          await client.end().catch(() => undefined);
        }
      },
    }).pipe(
      Effect.flatMap((missing) =>
        missing.length === 0 ? Effect.void : Effect.fail(new DatabaseBehindError({ missing })),
      ),
      retryFor(options.waitFor ?? "5 minutes"),
    );
  });
