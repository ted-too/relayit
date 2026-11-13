import { objectStorageConfig } from "@repo/object-storage";
import { Config, Effect } from "effect";

export const templateBuilderConfig = Effect.gen(function* () {
  const config = yield* Config.all({
    databaseUrl: Config.redacted("DATABASE_URL"),
    hostname: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
    logLevel: Config.logLevel("LOG_LEVEL").pipe(Config.withDefault("Info")),
    port: Config.port("PORT").pipe(Config.withDefault(3006)),
    redisKeyPrefix: Config.string("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.redacted("REDIS_URL"),
    templatingBuilderSecret: Config.redacted("TEMPLATING_BUILDER_SECRET"),
  });
  return { ...config, objectStorage: yield* objectStorageConfig };
});

export type TemplateBuilderConfig = Effect.Success<typeof templateBuilderConfig>;
