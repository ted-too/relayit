import { objectStorageConfig } from "@repo/object-storage";
import { Config, Effect } from "effect";

export const apiConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    apiUrl: Config.url("API_URL"),
    betterAuthSecrets: Config.redacted("BETTER_AUTH_SECRETS"),
    databaseUrl: Config.redacted("DATABASE_URL"),
    hostname: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
    logLevel: Config.logLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    port: Config.port("PORT").pipe(Config.withDefault(3005)),
    redisKeyPrefix: Config.string("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.redacted("REDIS_URL"),
  });
  return {
    ...config,
    objectStorage: yield* objectStorageConfig,
  };
});

export type ApiConfig = Effect.Success<typeof apiConfig>;
