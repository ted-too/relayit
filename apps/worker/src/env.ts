import { objectStorageConfig } from "@repo/object-storage";
import { emailBackendConfig, selectEmailBackend } from "@repo/provider-aws/email/backend";
import { Config, Effect, Option, Redacted } from "effect";

export const workerConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    // Where SES's notifications reach the api: the worker points SNS at it.
    apiUrl: Config.URL("API_URL"),
    // The dashboard origin, for the List-Unsubscribe links in marketing mail.
    appUrl: Config.URL("APP_URL"),
    betterAuthSecrets: Config.Redacted("BETTER_AUTH_SECRETS"),
    cfApiToken: Config.Redacted("CF_API_TOKEN").pipe(Config.option),
    cfRootDomain: Config.String("CF_ROOT_DOMAIN").pipe(Config.option),
    cfZoneId: Config.String("CF_ZONE_ID").pipe(Config.option),
    databaseUrl: Config.Redacted("DATABASE_URL"),
    emailBackend: Config.Literals(["ses", "fake"], "EMAIL_BACKEND").pipe(Config.option),
    logLevel: Config.LogLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    nodeEnv: Config.String("NODE_ENV").pipe(Config.option),
    redisKeyPrefix: Config.String("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.Redacted("REDIS_URL"),
    // The deployment's SES account; only EMAIL_BACKEND=ses needs them.
    sesAccessKeyId: Config.String("SES_ACCESS_KEY_ID").pipe(Config.option),
    sesRegions: Config.String("SES_REGIONS").pipe(Config.option),
    sesSecretAccessKey: Config.Redacted("SES_SECRET_ACCESS_KEY").pipe(Config.option),
  });
  return {
    ...config,
    emailBackend: yield* emailBackendConfig({
      accessKeyId: Option.getOrUndefined(config.sesAccessKeyId),
      kind: yield* selectEmailBackend({
        configured: Option.getOrUndefined(config.emailBackend),
        nodeEnv: Option.getOrUndefined(config.nodeEnv),
      }),
      regions: Option.getOrUndefined(config.sesRegions),
      secretAccessKey: Option.getOrUndefined(
        config.sesSecretAccessKey.pipe(Option.map(Redacted.value)),
      ),
    }),
    objectStorage: yield* objectStorageConfig,
  };
});

export type WorkerConfig = Effect.Success<typeof workerConfig>;
