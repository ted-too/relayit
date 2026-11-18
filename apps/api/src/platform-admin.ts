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
 * 6 the sessions could not be confirmed.
 */
import { setPlatformAdmin } from "@repo/persistence/auth/platform-admin";
import { makeDbLive } from "@repo/persistence/db/effect";
import { Effect, Layer, Redacted } from "effect";
import { apiConfig } from "./env";
import { ApiAuth } from "./lib/auth";

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
      ApiAuth.layer({ ...config, rateLimit: false }).pipe(
        Layer.provide(makeDbLive({ databaseUrl: Redacted.value(config.databaseUrl) })),
      ),
    ),
  );
  const count = `${sessions} open ${sessions === 1 ? "session" : "sessions"}`;
  console.log(
    action === "grant"
      ? `${email} is a platform admin. ${count} of theirs now carry the role.`
      : `${email} is no longer a platform admin. ${count} of theirs ended: they are signed out.`,
  );
}).pipe(
  Effect.scoped,
  Effect.catch((error) => {
    switch (error._tag) {
      case "PlatformAdminUserNotFound":
        return stop(3, `No user has the email ${error.email}. Sign up in the dashboard first.`);
      case "PlatformAdminSessionsStale":
        return stop(
          6,
          `The role is changed in the database, but ${error.stale} of the user's sessions still carry the old one. Run this again.`,
        );
      case "PlatformAdminStoreError": {
        const changed = error.roleChanged
          ? "The role is changed in the database, but the user's sessions are not confirmed: run this again."
          : "Nothing was changed.";
        return error.store === "database"
          ? stop(
              5,
              `The database (DATABASE_URL) could not be reached or refused the change. ${changed}`,
            )
          : stop(6, `The session store (REDIS_URL) could not be reached. ${changed}`);
      }
      case "SqlError":
        return stop(5, "The database (DATABASE_URL) could not be reached. Nothing was changed.");
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
