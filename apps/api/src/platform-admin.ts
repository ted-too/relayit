/**
 * `bun platform-admin.js grant|remove <email>`, run by an operator in the api's container:
 * how a deployment's platform admins are made and unmade. The first admin has no admin to
 * grant them the role, and a role written straight to the database is not seen by the
 * sessions the user already has (see `setPlatformAdmin`).
 *
 * It reads the api's whole environment and builds better-auth exactly as the api does, so
 * it reaches the api's sessions and rewrites them in the shape the api stores.
 *
 * Exit codes: 0 changed and confirmed, 2 usage, 3 no such user, 4 environment, 5 database,
 * 6 the sessions could not be confirmed. The last line printed is the outcome: a failing
 * Redis logs its reconnects, and better-auth its own errors, before it.
 */
import { JobsLive } from "@repo/jobs";
import { hasStoredSessions, setPlatformAdmin } from "@repo/persistence/auth/platform-admin";
import { makeDbLive } from "@repo/persistence/db/effect";
import { makeRedisClient, makeRedisLive } from "@repo/redis";
import { Effect, Layer, Redacted } from "effect";
import { apiConfig } from "./env";
import { ApiAuth } from "./lib/auth";
import { changedLines, unconfirmedLine } from "./platform-admin-outcome";

const args = Bun.argv.slice(2);
const [action, email] = args;
if (args.length !== 2 || (action !== "grant" && action !== "remove") || !email) {
  console.error("Usage: bun platform-admin.js grant|remove <email>");
  process.exit(2);
}

const stop = (code: number, line: string) =>
  Effect.sync(() => {
    console.error(line);
    process.exitCode = code;
  });

const program = Effect.gen(function* () {
  const config = yield* apiConfig;
  const { sessions } = yield* Effect.gen(function* () {
    const { auth } = yield* ApiAuth;
    return yield* setPlatformAdmin(auth, { admin: action === "grant", email });
  }).pipe(
    Effect.provide(
      // What the api's better-auth hooks run with; nothing here reaches them.
      ApiAuth.layer({ ...config, rateLimit: false }).pipe(
        Layer.provide(
          Layer.merge(
            makeDbLive({ databaseUrl: Redacted.value(config.databaseUrl) }),
            JobsLive.pipe(
              Layer.provide(
                makeRedisLive({
                  keyPrefix: config.redisKeyPrefix,
                  url: Redacted.value(config.redisUrl),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  // Nothing found is no evidence the change reached a session: say where it looked, and
  // whether anyone's sessions are there at all.
  const redisUrl = Redacted.value(config.redisUrl);
  const empty =
    sessions === 0 &&
    !(yield* Effect.acquireUseRelease(
      Effect.sync(() => makeRedisClient({ url: redisUrl })),
      (redis) => hasStoredSessions(redis, config.redisKeyPrefix),
      (redis) => Effect.sync(() => redis.close()),
    ));
  for (const line of changedLines({
    action,
    email,
    sessions,
    store: { empty, host: new URL(redisUrl).host, keyPrefix: config.redisKeyPrefix },
  })) {
    console.log(line);
  }
}).pipe(
  Effect.scoped,
  Effect.catch((error) => {
    switch (error._tag) {
      case "PlatformAdminUserNotFound":
        return stop(3, `No user has the email ${error.email}. Sign up in the dashboard first.`);
      case "PlatformAdminSessionsStale":
        return stop(
          6,
          unconfirmedLine(action, `sessions of theirs read back unchanged: ${error.stale}`),
        );
      case "PlatformAdminStoreError": {
        const where =
          error.store === "database"
            ? "The database (DATABASE_URL) could not be reached or refused the change."
            : "The session store (REDIS_URL) could not be reached.";
        return stop(
          error.store === "database" ? 5 : 6,
          error.roleChanged
            ? `${where} ${unconfirmedLine(action, "their sessions are not confirmed")}`
            : `${where} Nothing was changed.`,
        );
      }
      case "SqlError":
        return stop(5, "The database (DATABASE_URL) could not be reached. Nothing was changed.");
      case "RedisCommandError":
      case "RedisResponseError":
        return stop(6, "The session store (REDIS_URL) could not be reached. Nothing was changed.");
      // What is left is the environment's: a variable missing, or a combination refused.
      default:
        return stop(
          4,
          `The api's environment is not usable: ${error.message.replace(/\s+/g, " ")}`,
        );
    }
  }),
);

await Effect.runPromise(program);
