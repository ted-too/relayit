import { objectStorageConfig } from "@repo/object-storage";
import { selectEmailBackend } from "@repo/provider-aws/email/backend";
import { Config, Effect, Option } from "effect";

export const apiConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    apiUrl: Config.url("API_URL"),
    appUrl: Config.url("APP_URL"),
    betterAuthSecrets: Config.redacted("BETTER_AUTH_SECRETS"),
    cfApiToken: Config.redacted("CF_API_TOKEN").pipe(Config.option),
    cfRootDomain: Config.string("CF_ROOT_DOMAIN").pipe(Config.option),
    cfZoneId: Config.string("CF_ZONE_ID").pipe(Config.option),
    databaseUrl: Config.redacted("DATABASE_URL"),
    emailBackend: Config.literals(["ses", "fake"], "EMAIL_BACKEND").pipe(Config.option),
    hostname: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
    logLevel: Config.logLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    nodeEnv: Config.string("NODE_ENV").pipe(Config.option),
    port: Config.port("PORT").pipe(Config.withDefault(3005)),
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

export type ApiConfig = Effect.Success<typeof apiConfig>;
