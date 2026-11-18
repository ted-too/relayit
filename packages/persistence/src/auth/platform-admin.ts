import { Data, Effect } from "effect";
import { COOKIE_PREFIX } from "./constants";
import type { Auth, AuthRedis } from "./server";

export class PlatformAdminUserNotFound extends Data.TaggedError("PlatformAdminUserNotFound")<{
  readonly email: string;
}> {
  override readonly message = "No user has that email.";
}

/** The database or the session store (Redis) failed; `roleChanged` says whether the row was written first. */
export class PlatformAdminStoreError extends Data.TaggedError("PlatformAdminStoreError")<{
  readonly cause: unknown;
  readonly roleChanged: boolean;
  readonly store: "database" | "sessions";
}> {
  override readonly message = "The platform admin role could not be changed and confirmed.";
}

/** The row has the new role, and `stale` sessions of the user were read back without it. */
export class PlatformAdminSessionsStale extends Data.TaggedError("PlatformAdminSessionsStale")<{
  readonly stale: number;
}> {
  override readonly message = "Sessions of the user still carry the role they had.";
}

/**
 * Grants or removes the platform admin role, the one way it is changed outside
 * better-auth's own `/auth/admin/set-role` (which needs an admin to call it, so cannot make
 * a deployment's first). `/auth/admin/*` authorises on the copy of the user each session
 * holds in Redis, so an update of the user's row alone leaves a removed admin with those
 * endpoints until their sessions end.
 *
 * - A grant writes through better-auth's `updateUser`, which also rewrites that copy in
 *   every session the user has open, so a new admin need not sign in again.
 * - A removal then ends the user's sessions. A rewrite alone can lose to a session renewal
 *   or a sign-in that read the old user and writes it back afterwards; better-auth's
 *   deletion also marks every session made before it as revoked.
 *
 * better-auth only logs a failure of either session step, so the sessions are read back
 * here: the result is how many were confirmed (rewritten for a grant, ended for a
 * removal), and anything unreadable or left with the other role is a failure. Zero for a
 * user known to be signed in means this ran against another Redis or key prefix than the
 * api's. `auth` must be configured as the api's is: a rewritten session keeps only the
 * user fields that instance's plugins declare.
 */
export const setPlatformAdmin = (
  auth: Auth,
  { admin, email }: { readonly admin: boolean; readonly email: string },
) =>
  Effect.gen(function* () {
    // The two roles better-auth's admin plugin has here; no others are configured.
    const role = admin ? "admin" : "user";
    const attempt = <A>(
      store: "database" | "sessions",
      roleChanged: boolean,
      run: () => Promise<A>,
    ) =>
      Effect.tryPromise({
        catch: (cause) => new PlatformAdminStoreError({ cause, roleChanged, store }),
        try: run,
      });
    const { internalAdapter } = yield* attempt("database", false, () => auth.$context);
    const found = yield* attempt("database", false, () => internalAdapter.findUserByEmail(email));
    if (!found) {
      return yield* new PlatformAdminUserNotFound({ email });
    }
    const userId = found.user.id;
    // Read before anything changes, so an unreachable Redis stops this with the row as it was.
    const open = yield* attempt("sessions", false, () => internalAdapter.listSessions(userId));
    yield* attempt("database", false, () => internalAdapter.updateUser(userId, { role }));
    if (!admin) {
      yield* attempt("sessions", true, () => internalAdapter.deleteUserSessions(userId));
    }
    const after = yield* attempt("sessions", true, async () => {
      const sessions = await internalAdapter.listSessions(userId);
      return Promise.all(sessions.map(({ token }) => internalAdapter.findSession(token)));
    });
    const ended = new Set(admin ? [] : open.map(({ token }) => token));
    // After a removal the only sessions left are ones signed in since, which have the new role.
    const stale = after.filter(
      (live) => live && (live.user.role !== role || ended.has(live.session.token)),
    ).length;
    if (stale > 0) {
      return yield* new PlatformAdminSessionsStale({ stale });
    }
    return { sessions: admin ? after.filter((live) => live !== null).length : open.length };
  });

/**
 * Whether Redis holds a session of any user under this key prefix. `setPlatformAdmin`
 * finding none of one user's sessions is ordinary; a store with none at all, on a
 * deployment anyone is signed in to, is not the api's.
 */
export const hasStoredSessions = (redis: AuthRedis, redisKeyPrefix: string) =>
  Effect.tryPromise({
    // The row is already written by the time this is asked.
    catch: (cause) => new PlatformAdminStoreError({ cause, roleChanged: true, store: "sessions" }),
    try: async () => {
      // better-auth's list of a user's sessions, as `createAuth` keys it; the prefix is literal.
      const pattern = `${`${redisKeyPrefix}${COOKIE_PREFIX}:auth:`.replace(/[\\*?[\]]/g, "\\$&")}active-sessions-*`;
      let cursor = "0";
      do {
        const [next, keys] = (await redis.send("SCAN", [
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          "1000",
        ])) as [string, string[]];
        if (keys.length > 0) {
          return true;
        }
        cursor = next;
      } while (cursor !== "0");
      return false;
    },
  });
