/**
 * better-auth's rate limit keys on the header `clientIpHeader` names, so one client
 * exhausting sign-in leaves another free; with none named, no header is trusted.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { RedisClient } from "bun";
import { Effect } from "effect";
import { createPromiseDb } from "../db/promise";
import { createAuth } from "./server";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

const BASE_URL = "http://localhost:3005";

describe("better-auth's rate limit per client IP", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning("Skipping rate limit test: TEST_DATABASE_URL or TEST_REDIS_URL unset");
    // The Redis test is opt-in.
    test.skip("rate limit per client IP", () => undefined);
    return;
  }

  const withAuth = (clientIpHeader: string | undefined) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        const redis = new RedisClient(testRedisUrl);
        const auth = createAuth({
          baseUrl: BASE_URL,
          clientIpHeader,
          db,
          rateLimit: true,
          redis,
          redisKeyPrefix: `test:${Bun.randomUUIDv7()}:`,
        });
        return { auth, db, redis };
      }),
      ({ db, redis }) =>
        Effect.promise(async () => {
          redis.close();
          await db.$client.end();
        }),
    );

  // better-auth allows three sign-in attempts per 10 seconds; the fourth is refused.
  const signInStatuses = (
    auth: ReturnType<typeof createAuth>,
    headers: Record<string, string>,
    attempts: number,
  ) =>
    Effect.promise(async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < attempts; attempt++) {
        const response = await auth.handler(
          new Request(`${BASE_URL}/auth/sign-in/email`, {
            body: JSON.stringify({ email: "nobody@relayit.test", password: "wrong-password" }),
            headers: { "content-type": "application/json", origin: BASE_URL, ...headers },
            method: "POST",
          }),
        );
        statuses.push(response.status);
      }
      return statuses;
    });

  it.live("limits two clients with different IPs separately", () =>
    Effect.gen(function* () {
      const { auth } = yield* withAuth("x-real-ip");

      const first = yield* signInStatuses(auth, { "x-real-ip": "203.0.113.1" }, 4);
      expect(first.slice(0, 3)).not.toContain(429);
      expect(first[3]).toBe(429);

      const second = yield* signInStatuses(auth, { "x-real-ip": "203.0.113.2" }, 1);
      expect(second).not.toContain(429);
    }).pipe(Effect.scoped),
  );

  it.live("trusts no header when none is named", () =>
    Effect.gen(function* () {
      const { auth } = yield* withAuth(undefined);

      const first = yield* signInStatuses(auth, { "x-forwarded-for": "203.0.113.1" }, 4);
      expect(first[3]).toBe(429);

      // A different X-Forwarded-For, which better-auth would trust by default, is the
      // same client.
      const second = yield* signInStatuses(auth, { "x-forwarded-for": "203.0.113.2" }, 1);
      expect(second).toEqual([429]);
    }).pipe(Effect.scoped),
  );
});
