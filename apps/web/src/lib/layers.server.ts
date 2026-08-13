import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { EmailProviderRegistry } from "@repo/channels/email/provider-registry";
import { JobsLive } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { makeDbLive } from "@repo/persistence/db/effect";
import { awsSesProviderFactory } from "@repo/provider-aws/email/runtime";
import { makeRedisLive } from "@repo/redis";
import { makeTemplatingBuilderClientLive } from "@repo/templating";
import { Effect, Layer, Logger, Redacted, References } from "effect";
import { env } from "@/env";
import { logEffectFailure } from "@/lib/log-failure.server";

const loggingLive = Layer.mergeAll(
  Logger.layer([
    process.env.NODE_ENV === "production"
      ? Logger.consoleJson
      : Logger.consolePretty(),
    Logger.tracerLogger,
  ]),
  Layer.succeed(References.MinimumLogLevel, env.LOG_LEVEL ?? "Info")
);

const secrets = parseBetterAuthSecrets(env.BETTER_AUTH_SECRETS);

const dbLive = makeDbLive({
  databaseUrl: env.DATABASE_URL,
});

const redisLive = makeRedisLive({ url: env.REDIS_URL });

const jobsLive = JobsLive.pipe(Layer.provide(redisLive));

const credentialsVaultLive = ProviderCredentialsVault.live(secrets);
const symmetricCryptoLive = SymmetricCrypto.live(secrets);

const emailProviderRegistryLive = EmailProviderRegistry.live(
  awsSesProviderFactory
);

const cloudflareConfigured =
  env.CF_API_TOKEN && env.CF_ROOT_DOMAIN && env.CF_ZONE_ID
    ? {
        apiToken: env.CF_API_TOKEN,
        rootDomain: env.CF_ROOT_DOMAIN,
        zoneId: env.CF_ZONE_ID,
      }
    : null;

const managedDnsLive = cloudflareConfigured
  ? EmailManagedDns.live(cloudflareConfigured).pipe(Layer.provide(dbLive))
  : EmailManagedDns.noop().pipe(Layer.provide(dbLive));

const templatingBuilderLive =
  env.TEMPLATING_BUILDER_URL && env.TEMPLATING_BUILDER_SECRET
    ? makeTemplatingBuilderClientLive({
        secret: Redacted.make(env.TEMPLATING_BUILDER_SECRET),
        url: env.TEMPLATING_BUILDER_URL,
      })
    : Layer.empty;

/**
 * App-edge Effect layer for management server fns (Spezshop-style).
 * Includes sandbox provision deps (Jobs, ManagedDns, vault, provider registry).
 * Templating builder client is present when URL + secret are configured.
 */
export const AppLive = Layer.mergeAll(
  dbLive,
  redisLive,
  jobsLive,
  credentialsVaultLive,
  symmetricCryptoLive,
  emailProviderRegistryLive,
  managedDnsLive,
  templatingBuilderLive,
  loggingLive
);

/** Cloudflare zone id when sandbox capability is configured; else null. */
export const sandboxCloudflareZoneId = cloudflareConfigured?.zoneId ?? null;

export const runApp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.tapCause(logEffectFailure("Server function failed")),
      Effect.provide(AppLive as unknown as Layer.Layer<R>)
    )
  );
