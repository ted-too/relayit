import {
  type Auth,
  createAuth as createBetterAuth,
} from "@repo/persistence/auth/server";
import { createPromiseDb, type PromiseDb } from "@repo/persistence/db/promise";
import { makeRedisClient } from "@repo/redis";
import { Effect } from "effect";

export interface ApiAuth {
  readonly auth: Auth;
  readonly close: () => Promise<void>;
  readonly db: PromiseDb;
}

export const createAuth = (config: {
  readonly apiUrl: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Runs infrastructure log effects with the process logger. */
  readonly runLog: (effect: Effect.Effect<void>) => void;
}): ApiAuth => {
  const db = createPromiseDb({
    databaseUrl: config.databaseUrl,
    onPoolError: (error) =>
      config.runLog(
        Effect.logWarning(
          "Database connection dropped; pool will reconnect",
          error
        ).pipe(Effect.annotateLogs({ connection: "auth" }))
      ),
  });
  const redis = makeRedisClient({
    onReconnect: (event) =>
      config.runLog(
        Effect.logWarning(
          "Redis connection lost; replaced client and retried",
          event.cause
        ).pipe(
          Effect.annotateLogs({
            code: event.code,
            command: event.command,
            connection: "auth",
          })
        )
      ),
    url: config.redisUrl,
  });
  const auth = createBetterAuth({
    baseUrl: config.apiUrl,
    db,
    redis,
  });

  return {
    auth,
    close: async () => {
      redis.close();
      await db.$client.end();
    },
    db,
  };
};
