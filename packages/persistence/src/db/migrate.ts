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

/**
 * Apply pending Drizzle migrations under a Postgres session advisory lock, so concurrent
 * runs are safe: losers wait, then no-op. No app calls this as it starts; a release runs
 * it once, before its apps (docs/operations/deploys.md).
 */
export const migrateDatabase = async (databaseUrl: string): Promise<void> => {
  const migrationsFolder = resolveMigrationsFolder();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_KEY1, LOCK_KEY2]);
    try {
      const db = drizzle({ client });
      const result = await migrate(db, { migrationsFolder });
      if (result != null) {
        throw new Error(`Database migration failed with exit code: ${result.exitCode}`);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_KEY1, LOCK_KEY2]);
    }
  } finally {
    await client.end();
  }
};

export class DatabaseBehindError extends Data.TaggedError("DatabaseBehindError")<{
  /** The migrations this build carries that the database has not had applied. */
  readonly missing: ReadonlyArray<string>;
}> {
  override readonly message =
    "The database is missing migrations this version needs. Run the migrate step first (`bun run migrate.js` in the api image)";
}

/**
 * What an app does before it serves: succeed once the database has every migration this
 * build carries, and fail with `DatabaseBehindError` if it still lacks one after `waitFor`
 * (five minutes unless given).
 *
 * Behind is refused because the app's queries would fail one by one. It waits rather than
 * exiting at once because a platform that starts services in no order (Railway) may start
 * this one while the release's migrate step is still running. A database that is ahead,
 * with migrations this build has never heard of, is fine: during a rollout the previous
 * version keeps running against the schema the new one migrated, so a migration must
 * always leave the previous release working.
 */
export const requireMigrated = (options: {
  readonly databaseUrl: string;
  readonly waitFor?: Duration.Input;
}) =>
  Effect.promise(async () => {
    // Drizzle decides what to run by name, so the same comparison says what is missing.
    const carried = readMigrationFiles({ migrationsFolder: resolveMigrationsFolder() });
    const client = new Client({ connectionString: options.databaseUrl });
    await client.connect();
    try {
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
      await client.end();
    }
  }).pipe(
    Effect.flatMap((missing) =>
      missing.length === 0 ? Effect.void : Effect.fail(new DatabaseBehindError({ missing })),
    ),
    Effect.tapError((error) =>
      Effect.logWarning("Waiting for the migrate step: the database is behind this version").pipe(
        Effect.annotateLogs({ missing: error.missing.join(", ") }),
      ),
    ),
    Effect.retry({
      schedule: Schedule.spaced("2 seconds").pipe(
        Schedule.upTo({ duration: options.waitFor ?? "5 minutes" }),
      ),
    }),
  );
