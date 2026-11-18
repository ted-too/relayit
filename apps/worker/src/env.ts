import { objectStorageConfig } from "@repo/object-storage";
import { selectEmailBackend } from "@repo/provider-aws/email/backend";
import { Config, Effect, Option } from "effect";

export const workerConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    // Where SES's notifications reach the api: the worker points SNS at it.
    apiUrl: Config.url("API_URL"),
    // The dashboard origin, for the List-Unsubscribe links in marketing mail.
    appUrl: Config.url("APP_URL"),
    betterAuthSecrets: Config.redacted("BETTER_AUTH_SECRETS"),
    cfApiToken: Config.redacted("CF_API_TOKEN").pipe(Config.option),
    cfRootDomain: Config.string("CF_ROOT_DOMAIN").pipe(Config.option),
    cfZoneId: Config.string("CF_ZONE_ID").pipe(Config.option),
    databaseUrl: Config.redacted("DATABASE_URL"),
    emailBackend: Config.literals(["ses", "fake"], "EMAIL_BACKEND").pipe(Config.option),
    logLevel: Config.logLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    nodeEnv: Config.string("NODE_ENV").pipe(Config.option),
    redisKeyPrefix: Config.string("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.redacted("REDIS_URL"),
  });
  return {
    ...config,
    emailBackend: yield* selectEmailBackend({
      configured: Option.getOrUndefined(config.emailBackend),
      nodeEnv: Option.getOrUndefined(config.nodeEnv),
    }),
    objectStorage: yield* objectStorageConfig,
  };
});

export type WorkerConfig = Effect.Success<typeof workerConfig>;
