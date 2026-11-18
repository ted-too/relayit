/**
 * A release's migrate step: `bun run migrate.js` in the api image, run to completion before
 * the release's apps start (docs/operations/deploys.md). Exits 0 once the database has
 * every migration this image carries, whether it applied them or found them applied, and
 * non-zero when it could not.
 */
import { logged } from "@repo/logging";
import { migrateDatabase } from "@repo/persistence/db/migrate";
import { Config, Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  const databaseUrl = yield* Config.Redacted("DATABASE_URL");
  yield* Effect.promise(() => migrateDatabase(Redacted.value(databaseUrl)));
  yield* Effect.logInfo("Database migrations up to date");
});

Effect.runFork(program.pipe(logged("Migration failed")));
