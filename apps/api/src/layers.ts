import { UsageLive, UsagePolicyLive } from "@repo/channels/usage";
import { JobsLive } from "@repo/jobs";
import { loggingLive } from "@repo/logging";
import { makeObjectStorageLayer } from "@repo/object-storage";
import { makeDbLive } from "@repo/persistence/db/effect";
import { makeRedisLive } from "@repo/redis";
import { Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import type { ApiConfig } from "./env";

/** What the routes need beyond `ApiAuth`, and the app logger, for the length of the server. */
export const makeApiServices = (config: ApiConfig) => {
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

  return Layer.mergeAll(
    dbLive,
    redisLive,
    objectStorageLive,
    usageLive,
    jobsLive,
    httpLive,
    logging,
  );
};
