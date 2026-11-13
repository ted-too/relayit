import * as NodeOS from "node:os";
import { EmailBackend } from "@repo/channels/email/backend";
import { makeEmailDeliverHandler } from "@repo/channels/email/delivery";
import { ensureSandboxDomain } from "@repo/channels/email/sandbox";
import {
  emailVerifyCustomDomainHandler,
  emailVerifyOwnershipHandler,
  emailVerifySandboxDomainHandler,
} from "@repo/channels/email/verification";
import { registerJobHandler, runJobWorker } from "@repo/jobs";
import { LoggingLive, logEffectFailure } from "@repo/logging";
import { getCurrentBetterAuthSecret } from "@repo/persistence/crypto/auth-secrets";
import { SES_NOTIFICATIONS_PATH } from "@repo/provider-aws/email/webhooks";
import { webhookDeliverHandler } from "@repo/webhooks";
import { Cause, Effect, Fiber, Redacted } from "effect";
import { workerConfig } from "./env";
import { cloudflareFromConfig, makeWorkerLayer } from "./layers";

const TRAILING_SLASH = /\/$/;

// Never migrates: the api, web and builder apply migrations as they start, and this assumes
// a current schema.
const workerProgram = Effect.gen(function* () {
  const config = yield* workerConfig;

  const run = Effect.gen(function* () {
    // The fake backend has no infrastructure: nothing to point at the api.
    if (config.emailBackend.kind === "fake") {
      yield* Effect.logInfo(
        "Email backend is fake: sends are simulated and never leave this machine",
      );
    } else {
      const backend = yield* EmailBackend;
      yield* backend
        .ensureInfrastructure({
          deliveryWebhookUrl: `${config.apiUrl.toString().replace(TRAILING_SLASH, "")}${SES_NOTIFICATIONS_PATH}`,
        })
        .pipe(Effect.catchCause(logEffectFailure("Failed to ensure SES infrastructure")));
    }

    const cloudflare = cloudflareFromConfig(config);
    if (cloudflare) {
      yield* ensureSandboxDomain({
        cloudflareZoneId: cloudflare.zoneId,
        rootDomain: cloudflare.rootDomain,
      }).pipe(Effect.catchCause(logEffectFailure("Failed to ensure the Sandbox Domain")));
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
