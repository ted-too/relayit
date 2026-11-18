import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { UsageLive, UsagePolicyLive } from "@repo/channels/usage";
import { DeadLetterStoreLive, JobsLive } from "@repo/jobs";
import { loggingLive } from "@repo/logging";
import { makeObjectStorageLayer } from "@repo/object-storage";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { makeDbLive } from "@repo/persistence/db/effect";
import { emailBackendLayer } from "@repo/provider-aws/email/backend";
import { makeRedisLive } from "@repo/redis";
import { Layer, type Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { WorkerConfig } from "./env";

const optionValue = <A>(option: Option.Option<A>): A | undefined =>
  option._tag === "Some" ? option.value : undefined;

const cloudflareFromConfig = (config: WorkerConfig) => {
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

export const makeWorkerLayer = (config: WorkerConfig) => {
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
  const emailBackendLive = emailBackendLayer(config.emailBackend).pipe(
    Layer.provide(Layer.mergeAll(dbLive, jobsLive, logging)),
  );
  const cloudflareConfig = cloudflareFromConfig(config);
  const managedDnsLive = cloudflareConfig
    ? EmailManagedDns.live(cloudflareConfig).pipe(Layer.provide(dbLive))
    : EmailManagedDns.noop().pipe(Layer.provide(dbLive));

  return Layer.mergeAll(
    dbLive,
    redisLive,
    objectStorageLive,
    usageLive,
    jobsLive,
    deadLetterStoreLive,
    httpLive,
    ProviderCredentialsVault.live(secrets),
    SymmetricCrypto.live(secrets),
    emailBackendLive,
    managedDnsLive,
    logging,
  );
};
