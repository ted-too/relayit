import { type Auth, createAuth as createBetterAuth } from "@repo/persistence/auth/server";
import { createPromiseDb, type PromiseDb } from "@repo/persistence/db/promise";
import { makeRedisClient } from "@repo/redis";
import { Context, Effect, Layer } from "effect";

/**
 * better-auth, which verifies API keys, and the promise database the key lookups use. Both
 * are closed when the layer is released.
 */
export class ApiAuth extends Context.Service<
  ApiAuth,
  { readonly auth: Auth; readonly db: PromiseDb }
>()("api/ApiAuth") {
  static readonly layer = (config: {
    readonly apiUrl: string;
    readonly databaseUrl: string;
    readonly redisKeyPrefix: string;
    readonly redisUrl: string;
  }) =>
    Layer.effect(
      ApiAuth,
      Effect.gen(function* () {
        // The pool and the Redis client report connection trouble from callbacks; run those
        // logs with the app's logger.
        const services = yield* Effect.context<never>();
        const runLog = (effect: Effect.Effect<void>) => Effect.runForkWith(services)(effect);
        const db = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createPromiseDb({
              databaseUrl: config.databaseUrl,
              onPoolError: (error) =>
                runLog(
                  Effect.logWarning("Database connection dropped; pool will reconnect", error).pipe(
                    Effect.annotateLogs({ connection: "auth" }),
                  ),
                ),
            }),
          ),
          (db) => Effect.promise(() => db.$client.end()),
        );
        const redis = yield* Effect.acquireRelease(
          Effect.sync(() =>
            makeRedisClient({
              onReconnect: (event) =>
                runLog(
                  Effect.logWarning(
                    "Redis connection lost; replaced client and retried",
                    event.cause,
                  ).pipe(
                    Effect.annotateLogs({
                      code: event.code,
                      command: event.command,
                      connection: "auth",
                    }),
                  ),
                ),
              url: config.redisUrl,
            }),
          ),
          (redis) => Effect.sync(() => redis.close()),
        );
        const auth = createBetterAuth({
          baseUrl: config.apiUrl,
          db,
          redis,
          redisKeyPrefix: config.redisKeyPrefix,
        });
        return { auth, db };
      }),
    );
}
