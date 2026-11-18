/**
 * better-auth's secondary storage on Redis: the two operations it requires since 1.7 run as
 * single Redis steps, so a counter's window starts with its first request and a one-time
 * value is read by one caller only.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { RedisClient } from "bun";
import { Effect } from "effect";
import { createPromiseDb } from "../db/promise";
import { COOKIE_PREFIX } from "./constants";
import { createAuth } from "./server";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

describe("better-auth's secondary storage (Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping secondary storage test: TEST_DATABASE_URL or TEST_REDIS_URL unset",
    );
    // The Redis test is opt-in.
    test.skip("secondary storage", () => undefined);
    return;
  }

  it.live("increments a counter whose expiry is set once, and reads a value once", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({
        db: createPromiseDb({ databaseUrl: testDatabaseUrl }),
        redis: new RedisClient(testRedisUrl),
      })),
      ({ db, redis }) =>
        Effect.promise(async () => {
          const prefix = `test:${Bun.randomUUIDv7()}:`;
          const auth = createAuth({ db, rateLimit: false, redis, redisKeyPrefix: prefix });
          const storage = (await auth.$context).secondaryStorage;
          if (!storage) {
            throw new Error("createAuth configured no secondary storage");
          }
          const key = `${prefix}${COOKIE_PREFIX}:auth:counter`;

          expect(await storage.increment("counter", 60)).toBe(1);
          await redis.send("EXPIRE", [key, "30"]);
          expect(await storage.increment("counter", 60)).toBe(2);
          // The second increment kept the window the first one opened (shortened here).
          const ttl = Number(await redis.send("TTL", [key]));
          expect(ttl).toBeGreaterThan(0);
          expect(ttl).toBeLessThanOrEqual(30);

          await storage.set("once", "value");
          expect(await storage.getAndDelete("once")).toBe("value");
          expect(await storage.getAndDelete("once")).toBeNull();
          expect(await storage.get("once")).toBeNull();
        }),
      ({ db, redis }) =>
        Effect.promise(async () => {
          redis.close();
          await db.$client.end();
        }),
    ),
  );
});
