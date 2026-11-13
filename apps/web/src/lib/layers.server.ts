import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { JobsLive } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { makeDbLive } from "@repo/persistence/db/effect";
import {
  emailBackendConfig,
  emailBackendLayer,
  selectEmailBackend,
} from "@repo/provider-aws/email/backend";
import { makeRedisLive } from "@repo/redis";
import { makeTemplatingBuilderClientLive } from "@repo/templating";
import { Effect, Layer, Logger, Redacted, References } from "effect";
import { env } from "@/env";
import { logEffectFailure } from "@/lib/log-failure.server";

const loggingLive = Layer.mergeAll(
  Logger.layer([
    process.env.NODE_ENV === "production" ? Logger.consoleJson : Logger.consolePretty(),
    Logger.tracerLogger,
  ]),
  Layer.succeed(References.MinimumLogLevel, env.LOG_LEVEL ?? "Info"),
);

const secrets = parseBetterAuthSecrets(env.BETTER_AUTH_SECRETS);

const dbLive = makeDbLive({
  databaseUrl: env.DATABASE_URL,
});

// Redis logs reconnects from the layer itself; give it the app logger.
const redisLive = makeRedisLive({ keyPrefix: env.REDIS_KEY_PREFIX, url: env.REDIS_URL }).pipe(
  Layer.provide(loggingLive),
);

const jobsLive = JobsLive.pipe(Layer.provide(redisLive));

const symmetricCryptoLive = SymmetricCrypto.live(secrets);

// Throws at startup for EMAIL_BACKEND=fake under NODE_ENV=production, or SES without its
// variables.
const emailBackend = Effect.runSync(
  Effect.gen(function* () {
    return yield* emailBackendConfig({
      accessKeyId: env.SES_ACCESS_KEY_ID,
      kind: yield* selectEmailBackend({
        configured: env.EMAIL_BACKEND,
        nodeEnv: process.env.NODE_ENV,
      }),
      regions: env.SES_REGIONS,
      secretAccessKey: env.SES_SECRET_ACCESS_KEY,
    });
  }),
);
const emailBackendLive = emailBackendLayer(emailBackend).pipe(
  Layer.provide(Layer.mergeAll(dbLive, jobsLive, loggingLive)),
);

// Web edits only customer-published Domain records, which live in the database alone; the
// worker publishes the Sandbox Domain's on Cloudflare.
const managedDnsLive = EmailManagedDns.noop().pipe(Layer.provide(dbLive));

const templatingBuilderLive =
  env.TEMPLATING_BUILDER_URL && env.TEMPLATING_BUILDER_SECRET
    ? makeTemplatingBuilderClientLive({
        secret: Redacted.make(env.TEMPLATING_BUILDER_SECRET),
        url: env.TEMPLATING_BUILDER_URL,
      })
    : Layer.empty;

/**
 * App-edge Effect layer for management server fns (Spezshop-style): the database, Jobs,
 * the email backend and managed DNS for Domain setup, and the templating builder client
 * when its URL and secret are configured.
 */
export const AppLive = Layer.mergeAll(
  dbLive,
  redisLive,
  jobsLive,
  symmetricCryptoLive,
  emailBackendLive,
  managedDnsLive,
  templatingBuilderLive,
  loggingLive,
);

/** Runs a log effect with only the logging layer, so it works while infra is down. */
export const runLog = (effect: Effect.Effect<void>) =>
  Effect.runFork(effect.pipe(Effect.provide(loggingLive)));

export const runApp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.tapCause(logEffectFailure("Server function failed")),
      Effect.provide(AppLive as unknown as Layer.Layer<R>),
    ),
  );
