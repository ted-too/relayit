import { Config, type Effect } from "effect";

export const apiConfig = Config.all({
  apiUrl: Config.url("API_URL"),
  appUrl: Config.url("APP_URL"),
  betterAuthSecrets: Config.redacted("BETTER_AUTH_SECRETS"),
  cfApiToken: Config.redacted("CF_API_TOKEN").pipe(Config.option),
  cfRootDomain: Config.string("CF_ROOT_DOMAIN").pipe(Config.option),
  cfZoneId: Config.string("CF_ZONE_ID").pipe(Config.option),
  databaseUrl: Config.redacted("DATABASE_URL"),
  hostname: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
  port: Config.port("PORT").pipe(Config.withDefault(3005)),
  redisUrl: Config.redacted("REDIS_URL"),
  s3AccessKeyId: Config.redacted("S3_ACCESS_KEY_ID"),
  s3Bucket: Config.string("S3_BUCKET"),
  s3Endpoint: Config.url("S3_ENDPOINT"),
  s3Region: Config.string("S3_REGION").pipe(Config.withDefault("auto")),
  s3SecretAccessKey: Config.redacted("S3_SECRET_ACCESS_KEY"),
});

export type ApiConfig = Effect.Success<typeof apiConfig>;
