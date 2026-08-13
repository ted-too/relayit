import { Config, type Effect } from "effect";

export const templateBuilderConfig = Config.all({
  databaseUrl: Config.redacted("DATABASE_URL"),
  hostname: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
  port: Config.port("PORT").pipe(Config.withDefault(3006)),
  redisUrl: Config.redacted("REDIS_URL"),
  s3AccessKeyId: Config.redacted("S3_ACCESS_KEY_ID"),
  s3Bucket: Config.string("S3_BUCKET"),
  s3Endpoint: Config.url("S3_ENDPOINT"),
  s3Region: Config.string("S3_REGION").pipe(Config.withDefault("auto")),
  s3SecretAccessKey: Config.redacted("S3_SECRET_ACCESS_KEY"),
  templatingBuilderSecret: Config.redacted("TEMPLATING_BUILDER_SECRET"),
});

export type TemplateBuilderConfig = Effect.Success<
  typeof templateBuilderConfig
>;
