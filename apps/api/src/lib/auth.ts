import {
  type Auth,
  createAuth as createBetterAuth,
} from "@repo/persistence/auth/server";
import { createPromiseDb, type PromiseDb } from "@repo/persistence/db/promise";
import { RedisClient } from "bun";

export interface ApiAuth {
  readonly auth: Auth;
  readonly close: () => Promise<void>;
  readonly db: PromiseDb;
}

export const createAuth = (config: {
  readonly apiUrl: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
}): ApiAuth => {
  const db = createPromiseDb({ databaseUrl: config.databaseUrl });
  const redis = new RedisClient(config.redisUrl);
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
