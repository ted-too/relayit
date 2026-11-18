import { objectStorageConfig } from "@repo/object-storage";
import { Config, Effect } from "effect";

export const apiConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    apiUrl: Config.URL("API_URL"),
    betterAuthSecrets: Config.Redacted("BETTER_AUTH_SECRETS"),
    databaseUrl: Config.Redacted("DATABASE_URL"),
    hostname: Config.String("HOST").pipe(Config.withDefault("0.0.0.0")),
    logLevel: Config.LogLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    port: Config.Port("PORT").pipe(Config.withDefault(3005)),
    redisKeyPrefix: Config.String("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.Redacted("REDIS_URL"),
  });
  return {
    ...config,
    objectStorage: yield* objectStorageConfig,
  };
});

export type ApiConfig = Effect.Success<typeof apiConfig>;
