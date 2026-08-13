import { makeObjectStorageLive } from "@repo/object-storage";
import { makeDbLive } from "@repo/persistence/db/effect";
import { makeRedisLive } from "@repo/redis";
import {
  makeBuilderAuthServerLayer,
  TemplatingBuilderHandlersLive,
} from "@repo/templating";
import { Layer, Logger, Redacted, References } from "effect";
import type { TemplateBuilderConfig } from "./env";

export const loggingLive = (config: TemplateBuilderConfig) =>
  Layer.mergeAll(
    Logger.layer([
      Bun.env.NODE_ENV === "production"
        ? Logger.consoleJson
        : Logger.consolePretty(),
      Logger.tracerLogger,
    ]),
    Layer.succeed(References.MinimumLogLevel, config.logLevel)
  );

export const makeAppLayers = (config: TemplateBuilderConfig) => {
  const dbLive = makeDbLive({
    databaseUrl: Redacted.value(config.databaseUrl),
  });
  const redisLive = makeRedisLive({
    url: Redacted.value(config.redisUrl),
  });
  const objectStorageLive = makeObjectStorageLive({
    accessKeyId: Redacted.value(config.s3AccessKeyId),
    bucket: config.s3Bucket,
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    secretAccessKey: Redacted.value(config.s3SecretAccessKey),
  });
  const authLive = makeBuilderAuthServerLayer(config.templatingBuilderSecret);
  const infraLive = Layer.mergeAll(dbLive, redisLive, objectStorageLive);

  // Handlers pull DB / Redis / ObjectStorage at request time — provideMerge
  // satisfies those requirements and keeps the services in the runtime context.
  return Layer.mergeAll(
    TemplatingBuilderHandlersLive,
    authLive,
    loggingLive(config)
  ).pipe(Layer.provideMerge(infraLive));
};
