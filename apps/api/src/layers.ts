import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { UsageLive, UsagePolicyLive } from "@repo/channels/usage";
import { JobsLive } from "@repo/jobs";
import { loggingLive } from "@repo/logging";
import { makeObjectStorageLayer } from "@repo/object-storage";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { makeDbLive } from "@repo/persistence/db/effect";
import { emailBackendLayer } from "@repo/provider-aws/email/backend";
import { makeRedisLive } from "@repo/redis";
import { makeTemplatingBuilderClientLive } from "@repo/templating";
import { Layer, Option, Redacted } from "effect";
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
  // Adding and verifying a Domain registers it with SES.
  const emailBackendLive = emailBackendLayer(config.emailBackend).pipe(
    Layer.provide(Layer.mergeAll(dbLive, jobsLive, logging)),
  );
  // The dashboard edits only customer-published Domain records, which live in the
  // database alone; the worker publishes the Sandbox Domain's on Cloudflare.
  const managedDnsLive = EmailManagedDns.noop().pipe(Layer.provide(dbLive));
  // Absent, the Email Workspace operations answer 503.
  const templatingBuilderLive = Option.match(config.templatingBuilder, {
    onNone: () => Layer.empty,
    onSome: (builder) =>
      makeTemplatingBuilderClientLive({ secret: builder.secret, url: builder.url }),
  });

  return Layer.mergeAll(
    dbLive,
    redisLive,
    objectStorageLive,
    usageLive,
    jobsLive,
    httpLive,
    SymmetricCrypto.live(parseBetterAuthSecrets(Redacted.value(config.betterAuthSecrets))),
    emailBackendLive,
    managedDnsLive,
    templatingBuilderLive,
    logging,
  );
};
