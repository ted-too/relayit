/**
 * A release's migrate step: `bun run migrate.js` in the api image, run to completion before
 * the release's apps start (docs/operations/deploys.md). Exits 0 once the database has
 * every migration this image carries, whether it applied them or found them applied, and
 * non-zero when it could not.
 */
import { LoggingLive, logEffectFailure } from "@repo/logging";
import { migrateDatabase } from "@repo/persistence/db/migrate";
import { Config, Effect, Redacted } from "effect";

const program = Effect.gen(function* () {
  const databaseUrl = yield* Config.Redacted("DATABASE_URL");
  yield* Effect.promise(() => migrateDatabase(Redacted.value(databaseUrl)));
  yield* Effect.logInfo("Database migrations up to date");
});

Effect.runFork(
  program.pipe(
    Effect.provide(LoggingLive),
    // Outside the logging layer: a LOG_LEVEL it rejects must fail the step too, not end it
    // with exit 0 and nothing migrated.
    Effect.catchCause((cause) =>
      logEffectFailure("Migration failed")(cause).pipe(
        Effect.andThen(
          Effect.sync(() => {
            process.exitCode = 1;
          }),
        ),
      ),
    ),
  ),
);
