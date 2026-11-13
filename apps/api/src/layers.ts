import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { UsageLive, UsagePolicyLive } from "@repo/channels/usage";
import { DeadLetterStoreLive, JobsLive } from "@repo/jobs";
import { makeObjectStorageLayer } from "@repo/object-storage";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { makeDbLive } from "@repo/persistence/db/effect";
import { emailBackendLayer } from "@repo/provider-aws/email/backend";
import { makeRedisLive } from "@repo/redis";
import {
  Config,
  Effect,
  Layer,
  Logger,
  ManagedRuntime,
  type Option,
  Redacted,
  References,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { ApiConfig } from "./env";

const loggingLive = (logLevel: ApiConfig["logLevel"]) =>
  Layer.mergeAll(
    Logger.layer([
      Bun.env.NODE_ENV === "production" ? Logger.consoleJson : Logger.consolePretty(),
      Logger.tracerLogger,
    ]),
    Layer.succeed(References.MinimumLogLevel, logLevel),
  );

// Reads only LOG_LEVEL, so the rest of the config fails inside the program, where it is
// logged and exits non-zero, rather than while the logger is built, silently.
export const LoggingLive = Layer.unwrap(
  Effect.map(Config.logLevel("LOG_LEVEL").pipe(Config.withDefault("Info")), loggingLive),
);

const optionValue = <A>(option: Option.Option<A>): A | undefined =>
  option._tag === "Some" ? option.value : undefined;

const cloudflareFromConfig = (config: {
  readonly cfApiToken: Option.Option<Redacted.Redacted<string>>;
  readonly cfRootDomain: Option.Option<string>;
  readonly cfZoneId: Option.Option<string>;
}) => {
  const apiToken = optionValue(config.cfApiToken);
  const rootDomain = optionValue(config.cfRootDomain);
  const zoneId = optionValue(config.cfZoneId);
  if (!(apiToken && rootDomain && zoneId)) {
    return;
  }
  return {
    apiToken: Redacted.value(apiToken),
    rootDomain,
    zoneId,
  };
};

export const makeRuntime = (config: ApiConfig) => {
  const secrets = parseBetterAuthSecrets(Redacted.value(config.betterAuthSecrets));
  const logging = loggingLive(config.logLevel);
  const dbLive = makeDbLive({
    databaseUrl: Redacted.value(config.databaseUrl),
  });
  // Redis logs reconnects from the layer itself; give it the app logger.
  const redisLive = makeRedisLive({
    keyPrefix: config.redisKeyPrefix,
    url: Redacted.value(config.redisUrl),
  }).pipe(Layer.provide(logging));
  const objectStorageLive = makeObjectStorageLayer(config.objectStorage);
  const usagePolicyLive = UsagePolicyLive.pipe(Layer.provide(dbLive));
  const usageLive = UsageLive.pipe(Layer.provide(Layer.merge(redisLive, usagePolicyLive)));
  const jobsLive = JobsLive.pipe(Layer.provide(redisLive));
  const deadLetterStoreLive = DeadLetterStoreLive.pipe(Layer.provide(dbLive));
  const httpLive = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.RequestInit, {
        redirect: "error",
      }),
    ),
  );
  const credentialsVaultLive = ProviderCredentialsVault.live(secrets);
  const symmetricCryptoLive = SymmetricCrypto.live(secrets);
  const emailBackendLive = emailBackendLayer(config.emailBackend).pipe(
    Layer.provide(Layer.mergeAll(dbLive, jobsLive, logging)),
  );
  const cloudflareConfig = cloudflareFromConfig(config);
  const managedDnsLive = cloudflareConfig
    ? EmailManagedDns.live(cloudflareConfig).pipe(Layer.provide(dbLive))
    : EmailManagedDns.noop().pipe(Layer.provide(dbLive));

  return ManagedRuntime.make(
    Layer.mergeAll(
      dbLive,
      redisLive,
      objectStorageLive,
      usageLive,
      jobsLive,
      deadLetterStoreLive,
      httpLive,
      credentialsVaultLive,
      symmetricCryptoLive,
      emailBackendLive,
      managedDnsLive,
      logging,
    ),
  );
};
