import { UsageLive, UsagePolicyLive } from "@repo/channels/usage";
import { JobsLive } from "@repo/jobs";
import { loggingLive } from "@repo/logging";
import { makeObjectStorageLayer } from "@repo/object-storage";
import { makeDbLive } from "@repo/persistence/db/effect";
import { makeRedisLive } from "@repo/redis";
import { Layer, ManagedRuntime, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { ApiConfig } from "./env";

export const makeRuntime = (config: ApiConfig) => {
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
  const usagePolicyLive = UsagePolicyLive.pipe(Layer.provide(dbLive));
  const usageLive = UsageLive.pipe(Layer.provide(Layer.merge(redisLive, usagePolicyLive)));
  const jobsLive = JobsLive.pipe(Layer.provide(redisLive));
  const httpLive = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.RequestInit, {
        redirect: "error",
      }),
    ),
  );

  return ManagedRuntime.make(
    Layer.mergeAll(dbLive, redisLive, objectStorageLive, usageLive, jobsLive, httpLive, logging),
  );
};
