import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { EmailProviderRegistry } from "@repo/channels/email/provider-registry";
import { UsageLive, UsagePolicyLive } from "@repo/channels/usage";
import { DeadLetterStoreLive, JobsLive } from "@repo/jobs";
import { makeObjectStorageLive } from "@repo/object-storage";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { makeDbLive } from "@repo/persistence/db/effect";
import { awsSesProviderFactory } from "@repo/provider-aws/email/runtime";
import { makeRedisLive } from "@repo/redis";
import {
  Effect,
  Layer,
  Logger,
  ManagedRuntime,
  type Option,
  Redacted,
  References,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { type ApiConfig, apiConfig } from "./env";

export const loggingLive = (config: ApiConfig) =>
  Layer.mergeAll(
    Logger.layer([
      Bun.env.NODE_ENV === "production"
        ? Logger.consoleJson
        : Logger.consolePretty(),
      Logger.tracerLogger,
    ]),
    Layer.succeed(References.MinimumLogLevel, config.logLevel)
  );

export const LoggingLive = Layer.unwrap(Effect.map(apiConfig, loggingLive));

export interface ApiLayerConfig {
  readonly betterAuthSecrets: string;
  readonly cloudflare?: {
    readonly apiToken: string;
    readonly rootDomain: string;
    readonly zoneId: string;
  };
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly s3AccessKeyId: string;
  readonly s3Bucket: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3SecretAccessKey: string;
}

const optionValue = <A>(option: Option.Option<A>): A | undefined =>
  option._tag === "Some" ? option.value : undefined;

const cloudflareFromConfig = (config: {
  readonly cfApiToken: Option.Option<Redacted.Redacted<string>>;
  readonly cfRootDomain: Option.Option<string>;
  readonly cfZoneId: Option.Option<string>;
}): ApiLayerConfig["cloudflare"] => {
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
  const secrets = parseBetterAuthSecrets(
    Redacted.value(config.betterAuthSecrets)
  );
  const dbLive = makeDbLive({
    databaseUrl: Redacted.value(config.databaseUrl),
  });
  const redisLive = makeRedisLive({ url: Redacted.value(config.redisUrl) });
  const objectStorageLive = makeObjectStorageLive({
    accessKeyId: Redacted.value(config.s3AccessKeyId),
    bucket: config.s3Bucket,
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    secretAccessKey: Redacted.value(config.s3SecretAccessKey),
  });
  const usagePolicyLive = UsagePolicyLive.pipe(Layer.provide(dbLive));
  const usageLive = UsageLive.pipe(
    Layer.provide(Layer.merge(redisLive, usagePolicyLive))
  );
  const jobsLive = JobsLive.pipe(Layer.provide(redisLive));
  const deadLetterStoreLive = DeadLetterStoreLive.pipe(Layer.provide(dbLive));
  const httpLive = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.RequestInit, {
        redirect: "error",
      })
    )
  );
  const credentialsVaultLive = ProviderCredentialsVault.live(secrets);
  const symmetricCryptoLive = SymmetricCrypto.live(secrets);
  const emailProviderRegistryLive = EmailProviderRegistry.live(
    awsSesProviderFactory
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
      emailProviderRegistryLive,
      managedDnsLive,
      loggingLive(config)
    )
  );
};
