import type { Worker } from "node:cluster";
import cluster from "node:cluster";
import os from "node:os";
import { setTimeout as scheduleTimeout } from "node:timers";
import { makeEmailDeliverHandler } from "@repo/channels/email/delivery";
import {
  emailVerifyCustomDomainHandler,
  emailVerifyOwnershipHandler,
  emailVerifyProviderIdentityHandler,
  emailVerifySandboxDomainHandler,
} from "@repo/channels/email/verification";
import { registerJobHandler, runJobWorker } from "@repo/jobs";
import { getCurrentBetterAuthSecret } from "@repo/persistence/crypto/auth-secrets";
import { migrateOnStartup } from "@repo/persistence/db/migrate";
import { webhookDeliverHandler } from "@repo/webhooks";
import { Cause, Effect, Fiber, Redacted } from "effect";
import { Elysia } from "elysia";
import { apiConfig } from "./env";
import { LoggingLive, makeRuntime } from "./layers";
import { createAuth } from "./lib/auth";
import type { RunApiEffect } from "./lib/effect";
import { logEffectFailure } from "./lib/log-failure";
import { createEmailRoutes } from "./routes/messages/email";
import { createProviderWebhookRoutes } from "./routes/webhooks/providers";

const TRAILING_SLASH = /\/$/;

const jobWorkerOptions = {
  blockMs: 5000,
  concurrency: 10,
  consumer: `${os.hostname()}:${process.pid}`,
  count: 100,
  promotion: {
    intervalMs: 1000,
    limit: 100,
  },
  reclaim: {
    count: 100,
    intervalMs: 30_000,
    minIdleMs: 60_000,
  },
  restart: {
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
  },
} as const;

const makeJobWorkerProgram = (listUnsubscribe: {
  readonly secret: string;
  readonly webOrigin: string;
}) =>
  runJobWorker(
    [
      registerJobHandler(makeEmailDeliverHandler(listUnsubscribe)),
      registerJobHandler(webhookDeliverHandler),
      registerJobHandler(emailVerifyProviderIdentityHandler),
      registerJobHandler(emailVerifySandboxDomainHandler),
      registerJobHandler(emailVerifyCustomDomainHandler),
      registerJobHandler(emailVerifyOwnershipHandler),
    ],
    jobWorkerOptions
  );

const apiProgram = (startWorker: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const config = yield* apiConfig;
      yield* Effect.promise(() =>
        migrateOnStartup(Redacted.value(config.databaseUrl))
      );
      yield* Effect.logInfo("Database migrations up to date");
      const auth = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createAuth({
            apiUrl: config.apiUrl.toString(),
            databaseUrl: Redacted.value(config.databaseUrl),
            redisUrl: Redacted.value(config.redisUrl),
          })
        ),
        (apiAuth) => Effect.promise(apiAuth.close)
      );
      const runtime = yield* Effect.acquireRelease(
        Effect.sync(() => makeRuntime(config)),
        (apiRuntime) => apiRuntime.disposeEffect
      );
      yield* Effect.promise(runtime.context);
      if (startWorker) {
        const jobWorkerProgram = makeJobWorkerProgram({
          secret: getCurrentBetterAuthSecret(
            Redacted.value(config.betterAuthSecrets)
          ),
          webOrigin: config.appUrl.toString().replace(TRAILING_SLASH, ""),
        });
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            runtime.runFork(
              jobWorkerProgram.pipe(Effect.annotateLogs({ role: "worker" }))
            )
          ),
          Fiber.interrupt
        );
        yield* Effect.logInfo("Relayit Job worker started");
      }
      const runEffect: RunApiEffect = (effect, options) =>
        runtime.runPromise(
          effect.pipe(Effect.tapCause(logEffectFailure("API request failed"))),
          options
        );

      const app = new Elysia()
        .get("/health", () => ({ status: "ok" as const }))
        .group("/messages", (group) =>
          group.use(createEmailRoutes(auth, runEffect))
        )
        .group("/webhooks", (group) =>
          group.use(createProviderWebhookRoutes(runEffect))
        );

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          app.listen({ hostname: config.hostname, port: config.port })
        ),
        () => Effect.promise(() => app.stop())
      );
      yield* Effect.logInfo(
        `Relayit API listening on ${config.hostname}:${config.port}`
      );

      return yield* Effect.never;
    })
  );

const reportFailure = Effect.catchCause((cause) => {
  if (cause.reasons.every(Cause.isInterruptReason)) {
    return Effect.void;
  }

  return logEffectFailure("Process failed")(cause).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      })
    )
  );
});

const runApi = (startWorker: boolean) => {
  const fiber = Effect.runFork(
    apiProgram(startWorker).pipe(reportFailure, Effect.provide(LoggingLive))
  );
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    void Effect.runPromise(Fiber.interrupt(fiber)).finally(() => {
      cluster.worker?.disconnect();
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      process.kill(process.pid, signal);
    });
  };
  const onSigint = () => shutdown("SIGINT");
  const onSigterm = () => shutdown("SIGTERM");

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
};

const webConcurrency = () => {
  const configured = Bun.env.WEB_CONCURRENCY;
  if (configured === undefined) {
    return os.availableParallelism();
  }

  const concurrency = Number(configured);
  if (!(Number.isInteger(concurrency) && concurrency > 0)) {
    throw new Error("WEB_CONCURRENCY must be a positive integer");
  }

  return concurrency;
};

const clusterProgram = Effect.callback<void>((resume) => {
  let completed = false;
  let shuttingDown = false;
  let shutdownTimeout: ReturnType<typeof scheduleTimeout> | undefined;
  const clusterEvents = cluster as typeof cluster & {
    off(
      event: "exit",
      listener: (worker: Worker, code: number, signal: string) => void
    ): void;
    on(
      event: "exit",
      listener: (worker: Worker, code: number, signal: string) => void
    ): void;
  };
  const fork = () => cluster.fork();
  const finish = () => {
    if (completed) {
      return;
    }
    completed = true;
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
    }
    resume(Effect.void);
  };
  const onExit = (_worker: Worker, _code: number, _signal: string) => {
    if (!shuttingDown) {
      scheduleTimeout(() => {
        if (!shuttingDown) {
          fork();
        }
      }, 1000);
    }
  };
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill(signal);
    }

    shutdownTimeout = scheduleTimeout(() => {
      process.exitCode = 1;
      finish();
    }, 8000);
    cluster.disconnect(finish);
  };
  const onSigint = () => shutdown("SIGINT");
  const onSigterm = () => shutdown("SIGTERM");

  for (let worker = 0; worker < webConcurrency(); worker += 1) {
    fork();
  }
  clusterEvents.on("exit", onExit);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return Effect.sync(() => {
    shuttingDown = true;
    clusterEvents.off("exit", onExit);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
    }
  });
});

const primaryProgram = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* apiConfig;
    yield* Effect.promise(() =>
      migrateOnStartup(Redacted.value(config.databaseUrl))
    );
    yield* Effect.logInfo("Database migrations up to date");
    const runtime = yield* Effect.acquireRelease(
      Effect.sync(() => makeRuntime(config)),
      (apiRuntime) => apiRuntime.disposeEffect
    );
    yield* Effect.promise(runtime.context);
    const jobWorkerProgram = makeJobWorkerProgram({
      secret: getCurrentBetterAuthSecret(
        Redacted.value(config.betterAuthSecrets)
      ),
      webOrigin: config.appUrl.toString().replace(TRAILING_SLASH, ""),
    });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        runtime.runFork(
          jobWorkerProgram.pipe(Effect.annotateLogs({ role: "worker" }))
        )
      ),
      Fiber.interrupt
    );
    yield* Effect.logInfo("Relayit Job worker started in cluster primary");

    yield* clusterProgram;
  })
);

if (
  cluster.isPrimary &&
  Bun.env.NODE_ENV === "production" &&
  process.platform === "linux"
) {
  Effect.runFork(
    primaryProgram.pipe(reportFailure, Effect.provide(LoggingLive))
  );
} else {
  const isClusterChild = cluster.isWorker;
  runApi(!isClusterChild);
}
