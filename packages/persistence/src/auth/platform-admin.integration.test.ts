/**
 * `setPlatformAdmin` against a real Postgres and Redis: it reports the sessions it
 * confirmed, and does not report success when it could not reach them.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { RedisClient } from "bun";
import { Effect } from "effect";
import { createPromiseDb } from "../db/promise";
import { setPlatformAdmin } from "./platform-admin";
import { createAuth } from "./server";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

describe("setPlatformAdmin (PostgreSQL, Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning("Skipping platform admin test: TEST_DATABASE_URL or TEST_REDIS_URL unset");
    // The PostgreSQL and Redis test is opt-in.
    test.skip("setPlatformAdmin", () => undefined);
    return;
  }

  it.live("counts the sessions it confirmed, and fails when it cannot read them", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({
        db: createPromiseDb({ databaseUrl: testDatabaseUrl }),
        redis: new RedisClient(testRedisUrl),
      })),
      ({ db, redis }) =>
        Effect.gen(function* () {
          const run = Bun.randomUUIDv7();
          const email = `platform-admin-${run}@example.test`;
          const config = { db, rateLimit: false, redisKeyPrefix: `test:${run}:` };
          const auth = createAuth({ ...config, redis });
          const role = Effect.promise(async () => {
            const row = await db.query.user.findFirst({
              columns: { role: true },
              where: { email },
            });
            return row?.role;
          });
          // Signing up opens the user's one session.
          yield* Effect.promise(() =>
            auth.api.signUpEmail({ body: { email, name: "Admin", password: "a-long-password" } }),
          );

          // Redis is the boundary: every command fails as it does when unreachable.
          const unreachable = createAuth({
            ...config,
            redis: { send: () => Promise.reject(new Error("connection refused")) },
          });
          expect(
            yield* Effect.flip(setPlatformAdmin(unreachable, { admin: true, email })),
          ).toMatchObject({
            _tag: "PlatformAdminStoreError",
            roleChanged: false,
            store: "sessions",
          });
          expect(yield* role).toBe("user");

          // Another key prefix than the sessions' own finds none of them, and says so.
          const elsewhere = createAuth({ ...config, redis, redisKeyPrefix: `test:${run}:other:` });
          expect(yield* setPlatformAdmin(elsewhere, { admin: true, email })).toEqual({
            sessions: 0,
          });

          expect(yield* setPlatformAdmin(auth, { admin: true, email })).toEqual({ sessions: 1 });
          expect(yield* role).toBe("admin");
          expect(yield* setPlatformAdmin(auth, { admin: false, email })).toEqual({ sessions: 1 });
          expect(yield* role).toBe("user");
          // The session is gone, so a second removal has none to end.
          expect(yield* setPlatformAdmin(auth, { admin: false, email })).toEqual({ sessions: 0 });
        }),
      ({ db, redis }) =>
        Effect.promise(async () => {
          redis.close();
          await db.$client.end();
        }),
    ),
  );
});
