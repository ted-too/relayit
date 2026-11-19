import * as NodeOS from "node:os";
import { EmailBackend } from "@repo/channels/email/backend";
import {
  emailDeleteDomainIdentityHandler,
  removeUnlinkedDomains,
} from "@repo/channels/email/custom-domain";
import { emailRecheckProjectSendingPauseHandler } from "@repo/channels/email/deliverability";
import { endStuckDeliveries, makeEmailDeliverHandler } from "@repo/channels/email/delivery";
import { ensureSandboxDomain } from "@repo/channels/email/sandbox";
import {
  emailVerifyCustomDomainHandler,
  emailVerifyOwnershipHandler,
  emailVerifySandboxDomainHandler,
} from "@repo/channels/email/verification";
import { registerJobHandler, runJobWorker } from "@repo/jobs";
import { logged, logEffectFailure } from "@repo/logging";
import { getCurrentBetterAuthSecret } from "@repo/persistence/crypto/auth-secrets";
import { requireMigrated } from "@repo/persistence/db/migrate";
import { sesNotificationsUrl } from "@repo/provider-aws/email/webhooks";
import { webhookDeliverHandler } from "@repo/webhooks";
import { Effect, Fiber, Redacted } from "effect";
import { workerConfig } from "./env";
import { cloudflareFromConfig, makeWorkerLayer } from "./layers";

const workerProgram = Effect.gen(function* () {
  const config = yield* workerConfig;
  yield* requireMigrated({ databaseUrl: Redacted.value(config.databaseUrl) });

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
          deliveryWebhookUrl: sesNotificationsUrl(config.apiUrl),
        })
        .pipe(Effect.catchCause(logEffectFailure("Failed to ensure SES infrastructure")));
    }

    // Catches a Domain whose last link went where the api could not follow it up: a Project
    // deleted as the api stopped, or deleted in the database. Before the Sandbox Domain, which
    // is not set up on a root a Domain is on: one no Project holds any more should not stop it.
    yield* removeUnlinkedDomains().pipe(
      Effect.catchCause(logEffectFailure("Failed to remove Domains without a link")),
    );

    const cloudflare = cloudflareFromConfig(config);
    if (cloudflare) {
      yield* ensureSandboxDomain({
        cloudflareZoneId: cloudflare.zoneId,
        rootDomain: cloudflare.rootDomain,
      }).pipe(Effect.catchCause(logEffectFailure("Failed to ensure the Sandbox Domain")));
    }

    // A Delivery whose job was lost while it was `sending` has no run left to end it. Beside
    // the jobs and on a timer, not only at start: one can be left at any time, and a worker
    // may run for months.
    yield* Effect.forkChild(
      endStuckDeliveries.pipe(
        Effect.catchCause(logEffectFailure("Failed to end Deliveries left sending")),
        Effect.andThen(Effect.sleep("1 hour")),
        Effect.forever,
      ),
    );

    yield* Effect.logInfo("Relayit job worker started");
    return yield* runJobWorker(
      [
        registerJobHandler(
          makeEmailDeliverHandler({
            secret: getCurrentBetterAuthSecret(Redacted.value(config.betterAuthSecrets)),
            apiOrigin: config.apiUrl.origin,
          }),
        ),
        registerJobHandler(webhookDeliverHandler),
        registerJobHandler(emailVerifySandboxDomainHandler),
        registerJobHandler(emailVerifyCustomDomainHandler),
        registerJobHandler(emailVerifyOwnershipHandler),
        registerJobHandler(emailDeleteDomainIdentityHandler),
        registerJobHandler(emailRecheckProjectSendingPauseHandler),
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

const fiber = Effect.runFork(workerProgram.pipe(logged("Process failed")));
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
