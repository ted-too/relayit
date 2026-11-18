/**
 * `bun platform-admin.js grant|remove <email>`, run by an operator in the api's container:
 * how a deployment's platform admins are made and unmade. The first admin has no admin to
 * grant them the role, and a role written straight to the database is not seen by the
 * sessions the user already has (see `setPlatformAdmin`).
 */
import { setPlatformAdmin } from "@repo/persistence/auth/platform-admin";
import { createAuth } from "@repo/persistence/auth/server";
import { createPromiseDb } from "@repo/persistence/db/promise";
import { makeRedisClient } from "@repo/redis";
import { Config, Effect, Redacted } from "effect";

const [action, email] = Bun.argv.slice(2);

const program = Effect.gen(function* () {
  if ((action !== "grant" && action !== "remove") || !email) {
    console.error("Usage: bun platform-admin.js grant|remove <email>");
    process.exitCode = 2;
    return;
  }
  // The api's own variables: the same database, and the Redis and key prefix its sessions
  // are stored under.
  const config = yield* Config.all({
    apiUrl: Config.URL("API_URL"),
    databaseUrl: Config.Redacted("DATABASE_URL"),
    redisKeyPrefix: Config.String("REDIS_KEY_PREFIX").pipe(Config.withDefault("")),
    redisUrl: Config.Redacted("REDIS_URL"),
  });
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => createPromiseDb({ databaseUrl: Redacted.value(config.databaseUrl) })),
    (db) => Effect.promise(() => db.$client.end()),
  );
  const redis = yield* Effect.acquireRelease(
    Effect.sync(() => makeRedisClient({ url: Redacted.value(config.redisUrl) })),
    (redis) => Effect.sync(() => redis.close()),
  );
  const auth = createAuth({
    baseUrl: config.apiUrl.origin,
    db,
    rateLimit: false,
    redis,
    redisKeyPrefix: config.redisKeyPrefix,
  });
  const role = yield* Effect.promise(() =>
    setPlatformAdmin(auth, { admin: action === "grant", email }),
  );
  if (role === null) {
    console.error(`No user has the email ${email}. Sign up in the dashboard first.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    action === "grant"
      ? `${email} is a platform admin (role: ${role}).`
      : `${email} is no longer a platform admin (role: ${role}), in the sessions they have open too.`,
  );
}).pipe(Effect.scoped);

await Effect.runPromise(program);
