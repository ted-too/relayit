import { objectStorageConfig } from "@repo/object-storage";
import { Config, Effect } from "effect";

export const templateBuilderConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    databaseUrl: Config.Redacted("DATABASE_URL"),
    hostname: Config.String("HOST").pipe(Config.withDefault("0.0.0.0")),
    logLevel: Config.LogLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    port: Config.Port("PORT").pipe(Config.withDefault(3006)),
    redisKeyPrefix: Config.String("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.Redacted("REDIS_URL"),
    templatingBuilderSecret: Config.Redacted("TEMPLATING_BUILDER_SECRET"),
  });
  return { ...config, objectStorage: yield* objectStorageConfig };
});

export type TemplateBuilderConfig = Effect.Success<typeof templateBuilderConfig>;
