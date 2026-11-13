import * as NodeOS from "node:os";
import { makeEmailDeliverHandler } from "@repo/channels/email/delivery";
import { ensureAllEmailProviderInfrastructure } from "@repo/channels/email/ensure-provider-infrastructure";
import {
  emailVerifyCustomDomainHandler,
  emailVerifyOwnershipHandler,
  emailVerifyProviderIdentityHandler,
  emailVerifySandboxDomainHandler,
} from "@repo/channels/email/verification";
import { registerJobHandler, runJobWorker } from "@repo/jobs";
import { LoggingLive, logEffectFailure } from "@repo/logging";
import { getCurrentBetterAuthSecret } from "@repo/persistence/crypto/auth-secrets";
import { webhookDeliverHandler } from "@repo/webhooks";
import { Cause, Effect, Fiber, Redacted } from "effect";
import { workerConfig } from "./env";
import { makeWorkerLayer } from "./layers";

const TRAILING_SLASH = /\/$/;

// The schema is the api's to migrate: this process assumes a current one and never migrates.
const workerProgram = Effect.gen(function* () {
  const config = yield* workerConfig;

  const run = Effect.gen(function* () {
    // The fake backend has no infrastructure: nothing to point at the api.
    if (config.emailBackend === "fake") {
      yield* Effect.logInfo(
        "Email backend is fake: sends are simulated and never leave this machine",
      );
    } else {
      yield* ensureAllEmailProviderInfrastructure(config.apiUrl.toString()).pipe(
        Effect.catchCause(logEffectFailure("Failed to ensure email Provider infrastructure")),
      );
    }

    yield* Effect.logInfo("Relayit job worker started");
    return yield* runJobWorker(
      [
        registerJobHandler(
          makeEmailDeliverHandler({
            secret: getCurrentBetterAuthSecret(Redacted.value(config.betterAuthSecrets)),
            webOrigin: config.appUrl.toString().replace(TRAILING_SLASH, ""),
          }),
        ),
        registerJobHandler(webhookDeliverHandler),
        registerJobHandler(emailVerifyProviderIdentityHandler),
        registerJobHandler(emailVerifySandboxDomainHandler),
        registerJobHandler(emailVerifyCustomDomainHandler),
        registerJobHandler(emailVerifyOwnershipHandler),
      ],
      {
        blockMs: 5000,
        concurrency: 10,
        consumer: `${NodeOS.hostname()}:${process.pid}`,
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
      },
    );
  });

  return yield* run.pipe(
    Effect.annotateLogs({ role: "worker" }),
    Effect.provide(makeWorkerLayer(config)),
  );
});

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

const fiber = Effect.runFork(workerProgram.pipe(reportFailure, Effect.provide(LoggingLive)));
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
