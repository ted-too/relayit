/**
 * A release's migrate step: `bun run migrate.js` in the api image, run to completion before
 * the release's apps start (docs/operations/deploys.md). Exits 0 once the database has
 * every migration this image carries, whether it applied them or found them applied, and
 * non-zero when it could not. A database it cannot connect to is tried again for two
 * minutes first; a migration that fails is not. Its waits for locks end too (five minutes
 * for another run's advisory lock, 30 seconds for a table lock), failing the step.
 */
import { logged } from "@repo/logging";
import { migrateDatabase } from "@repo/persistence/db/migrate";
import { Config, Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  const databaseUrl = yield* Config.Redacted("DATABASE_URL");
  // Long enough for a Postgres that is starting or restarting, and short enough that the
  // step gives up and says why, with time left to migrate, inside the ten minutes a
  // platform's own limit on it is set to (docs/operations/deploys.md).
  yield* migrateDatabase({ databaseUrl: Redacted.value(databaseUrl), waitFor: "2 minutes" });
  yield* Effect.logInfo("Database migrations up to date");
});

Effect.runFork(program.pipe(logged("Migration failed")));
