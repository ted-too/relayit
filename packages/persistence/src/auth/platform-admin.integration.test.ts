/**
 * `setPlatformAdmin` against a real Postgres and Redis: it reports the sessions it
 * confirmed, and does not report success when it could not reach them.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { RedisClient } from "bun";
import { Effect } from "effect";
import { createPromiseDb } from "../db/promise";
import { hasStoredSessions, setPlatformAdmin } from "./platform-admin";
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
          // Nor has that prefix anyone's sessions, where the sessions' own has this user's.
          expect(yield* hasStoredSessions(redis, `test:${run}:other:`)).toBe(false);
          expect(yield* hasStoredSessions(redis, `test:${run}:`)).toBe(true);

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

  it.live("fails when the row changed and the sessions did not, and finishes on a second run", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => ({
        db: createPromiseDb({ databaseUrl: testDatabaseUrl }),
        redis: new RedisClient(testRedisUrl),
      })),
      ({ db, redis }) =>
        Effect.gen(function* () {
          const run = Bun.randomUUIDv7();
          const email = `platform-admin-stale-${run}@example.test`;
          const config = { db, rateLimit: false, redisKeyPrefix: `test:${run}:` };
          const auth = createAuth({ ...config, redis });
          const role = Effect.promise(async () => {
            const row = await db.query.user.findFirst({
              columns: { role: true },
              where: { email },
            });
            return row?.role;
          });
          yield* Effect.promise(() =>
            auth.api.signUpEmail({ body: { email, name: "Admin", password: "a-long-password" } }),
          );
          // Redis is the boundary. One that answers reads and refuses every write, so
          // better-auth's session step fails (and is only logged) and the read-back sees it.
          const readOnly = createAuth({
            ...config,
            redis: {
              send: (command, args) =>
                command === "GET"
                  ? redis.send(command, args)
                  : Promise.reject(new Error("READONLY")),
            },
          });
          // And one that is lost with its first write, so the read-back itself fails.
          const lostAtFirstWrite = () => {
            let lost = false;
            return createAuth({
              ...config,
              redis: {
                send: (command, args) => {
                  lost ||= command !== "GET";
                  return lost
                    ? Promise.reject(new Error("connection lost"))
                    : redis.send(command, args);
                },
              },
            });
          };

          // A grant whose session still says `user`: the row is changed, and it says so.
          expect(
            yield* Effect.flip(setPlatformAdmin(readOnly, { admin: true, email })),
          ).toMatchObject({ _tag: "PlatformAdminSessionsStale", stale: 1 });
          expect(yield* role).toBe("admin");
          expect(yield* setPlatformAdmin(auth, { admin: true, email })).toEqual({ sessions: 1 });

          // A removal whose session is still there, an admin's.
          expect(
            yield* Effect.flip(setPlatformAdmin(readOnly, { admin: false, email })),
          ).toMatchObject({ _tag: "PlatformAdminSessionsStale", stale: 1 });
          expect(yield* role).toBe("user");
          // Running it again ends the session.
          expect(yield* setPlatformAdmin(auth, { admin: false, email })).toEqual({ sessions: 1 });
          expect(yield* setPlatformAdmin(auth, { admin: false, email })).toEqual({ sessions: 0 });

          // The same two when the sessions cannot be read back at all.
          yield* Effect.promise(() =>
            auth.api.signInEmail({ body: { email, password: "a-long-password" } }),
          );
          const unconfirmed = {
            _tag: "PlatformAdminStoreError",
            roleChanged: true,
            store: "sessions",
          };
          expect(
            yield* Effect.flip(setPlatformAdmin(lostAtFirstWrite(), { admin: true, email })),
          ).toMatchObject(unconfirmed);
          expect(yield* role).toBe("admin");
          expect(yield* setPlatformAdmin(auth, { admin: true, email })).toEqual({ sessions: 1 });
          expect(
            yield* Effect.flip(setPlatformAdmin(lostAtFirstWrite(), { admin: false, email })),
          ).toMatchObject(unconfirmed);
          expect(yield* role).toBe("user");
          expect(yield* setPlatformAdmin(auth, { admin: false, email })).toEqual({ sessions: 1 });
        }),
      ({ db, redis }) =>
        Effect.promise(async () => {
          redis.close();
          await db.$client.end();
        }),
    ),
  );
});
