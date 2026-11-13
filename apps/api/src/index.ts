import { LoggingLive, logEffectFailure } from "@repo/logging";
import { migrateOnStartup } from "@repo/persistence/db/migrate";
import { getCurrentBetterAuthSecret } from "@repo/persistence/crypto/auth-secrets";
import { Cause, Effect, Fiber, Layer, Option, Redacted } from "effect";
import { apiConfig } from "./env";
import { apiServer } from "./http";
import { makeApiServices } from "./layers";
import { ApiAuth } from "./lib/auth";

const apiProgram = Effect.gen(function* () {
  const config = yield* apiConfig;
  yield* Effect.promise(() => migrateOnStartup(Redacted.value(config.databaseUrl)));
  yield* Effect.logInfo("Database migrations up to date");

  const server = apiServer({
    dashboard: {
      appOrigin: config.appUrl.origin,
      billing: Option.isSome(config.stripe),
      githubSignIn: Option.isSome(config.github),
    },
    hostname: config.hostname,
    port: config.port,
    unsubscribeSecret: getCurrentBetterAuthSecret(Redacted.value(config.betterAuthSecrets)),
  }).pipe(
    Layer.provide(
      ApiAuth.layer({
        ...config,
        // better-auth's rate limit is for deployments; development and tests sign in often.
        rateLimit: !Option.exists(config.nodeEnv, (env) => env === "development" || env === "test"),
      }),
    ),
    Layer.provide(makeApiServices(config)),
  );

  yield* Layer.build(server);
  yield* Effect.logInfo(`Relayit API listening on ${config.hostname}:${config.port}`);
  return yield* Effect.never;
}).pipe(Effect.scoped);

const reportFailure = Effect.catchCause((cause) => {
  if (cause.reasons.every(Cause.isInterruptReason)) {
    return Effect.void;
  }

  return logEffectFailure("Process failed")(cause).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    ),
  );
});

const fiber = Effect.runFork(apiProgram.pipe(reportFailure, Effect.provide(LoggingLive)));
let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  void Effect.runPromise(Fiber.interrupt(fiber)).finally(() => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.kill(process.pid, signal);
  });
};
const onSigint = () => shutdown("SIGINT");
const onSigterm = () => shutdown("SIGTERM");

process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);
