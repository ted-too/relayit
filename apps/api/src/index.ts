import openapi from "@elysia/openapi";
import { LoggingLive, logEffectFailure } from "@repo/logging";
import { migrateOnStartup } from "@repo/persistence/db/migrate";
import { SES_NOTIFICATIONS_PATH } from "@repo/provider-aws/email/webhooks";
import { Cause, Effect, Fiber, Redacted } from "effect";
import { Elysia } from "elysia";
import { apiConfig } from "./env";
import { makeRuntime } from "./layers";
import { type ApiAuth, createAuth } from "./lib/auth";
import type { RunApiEffect } from "./lib/effect";
import { createLegacySendRoutes } from "./routes/compat/send";
import { createEmailRoutes } from "./routes/messages/email";
import { createSesNotificationRoutes } from "./routes/webhooks/ses";

export function createHttpApp(auth: ApiAuth, runEffect: RunApiEffect) {
  return new Elysia()
    .use(
      openapi({
        documentation: {
          info: {
            description:
              "HTTP API for sending messages through Relayit. Prefer POST /messages/email for new integrations.",
            title: "Relayit API",
            version: "0.0.0",
          },
          tags: [
            {
              description: "Current send endpoints",
              name: "Send",
            },
            {
              description: "Compatibility send endpoints for existing integrations",
              name: "Legacy Send",
            },
          ],
        },
        exclude: {
          paths: ["/health", SES_NOTIFICATIONS_PATH],
        },
        path: "/docs",
        specPath: "/openapi.json",
        provider: "scalar",
      }),
    )
    .get("/health", () => ({ status: "ok" as const }), {
      detail: {
        hide: true,
      },
    })
    .use(createLegacySendRoutes(auth, runEffect))
    .group("/messages", (group) => group.use(createEmailRoutes(auth, runEffect)))
    .use(createSesNotificationRoutes(runEffect));
}

const apiProgram = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* apiConfig;
    yield* Effect.promise(() => migrateOnStartup(Redacted.value(config.databaseUrl)));
    yield* Effect.logInfo("Database migrations up to date");
    const services = yield* Effect.context<never>();
    const auth = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createAuth({
          apiUrl: config.apiUrl.toString(),
          databaseUrl: Redacted.value(config.databaseUrl),
          redisKeyPrefix: config.redisKeyPrefix,
          redisUrl: Redacted.value(config.redisUrl),
          runLog: Effect.runForkWith(services),
        }),
      ),
      (apiAuth) => Effect.promise(apiAuth.close),
    );
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => makeRuntime(config)),
      (apiRuntime) => apiRuntime.disposeEffect,
    );
    yield* Effect.promise(runtime.context);
    const runEffect: RunApiEffect = (effect, options) =>
      runtime.runPromise(
        effect.pipe(Effect.tapCause(logEffectFailure("API request failed"))),
        options,
      );

    const app = createHttpApp(auth, runEffect);

    yield* Effect.acquireRelease(
      Effect.sync(() => app.listen({ hostname: config.hostname, port: config.port })),
      () => Effect.promise(() => app.stop()),
    );
    yield* Effect.logInfo(`Relayit API listening on ${config.hostname}:${config.port}`);

    return yield* Effect.never;
  }),
);

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
