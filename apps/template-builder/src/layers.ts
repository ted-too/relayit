import { loggingLive } from "@repo/logging";
import { makeObjectStorageLayer } from "@repo/object-storage";
import { makeDbLive } from "@repo/persistence/db/effect";
import { makeRedisLive } from "@repo/redis";
import { makeBuilderAuthServerLayer, TemplatingBuilderHandlersLive } from "@repo/templating";
import { Layer, Redacted } from "effect";
import type { TemplateBuilderConfig } from "./env";

export const makeAppLayers = (config: TemplateBuilderConfig) => {
  const logging = loggingLive(config.logLevel);
  const dbLive = makeDbLive({
    databaseUrl: Redacted.value(config.databaseUrl),
  });
  // Redis logs reconnects from the layer itself; give it the app logger.
  const redisLive = makeRedisLive({
    keyPrefix: config.redisKeyPrefix,
    url: Redacted.value(config.redisUrl),
  }).pipe(Layer.provide(logging));
  const objectStorageLive = makeObjectStorageLayer(config.objectStorage);
  const authLive = makeBuilderAuthServerLayer(config.templatingBuilderSecret);
  const infraLive = Layer.mergeAll(dbLive, redisLive, objectStorageLive);

  // Handlers pull DB / Redis / ObjectStorage at request time — provideMerge
  // satisfies those requirements and keeps the services in the runtime context.
  return Layer.mergeAll(TemplatingBuilderHandlersLive, authLive, logging).pipe(
    Layer.provideMerge(infraLive),
  );
};
