import { Data, Effect } from "effect";
import { COOKIE_PREFIX } from "./constants";
import type { Auth, AuthRedis } from "./server";

export class PlatformAdminUserNotFound extends Data.TaggedError("PlatformAdminUserNotFound")<{
  readonly email: string;
}> {
  override readonly message = "No user has that email.";
}

/** The database or the session store (Redis) failed; `rowChanged` says whether the row was written first. */
export class PlatformAdminStoreError extends Data.TaggedError("PlatformAdminStoreError")<{
  readonly cause: unknown;
  readonly rowChanged: boolean;
  readonly store: "database" | "sessions";
}> {
  override readonly message = "The user could not be changed and their sessions confirmed.";
}

/** The row is changed, and `stale` sessions of the user were read back as they were before. */
export class PlatformAdminSessionsStale extends Data.TaggedError("PlatformAdminSessionsStale")<{
  readonly stale: number;
}> {
  override readonly message = "Sessions of the user are as they were before the change.";
}

/**
 * Writes an operator's change to a user through better-auth's `updateUser`, which also
 * rewrites the copy of the user that each of their sessions holds in Redis, and with
 * `endSessions` then ends those sessions.
 *
 * better-auth only logs a failure of either session step, so the sessions are read back
 * here: the result is how many were confirmed (ended, or rewritten when they are kept),
 * and anything unreadable, left without the change, or left open when it should have
 * ended is a failure. Zero for a user known to be signed in means this ran against another
 * Redis or key prefix than the api's. `auth` must be configured as the api's is: a
 * rewritten session keeps only the user fields that instance's plugins declare.
 */
const changeUser = (
  auth: Auth,
  email: string,
  {
    endSessions,
    update,
  }: {
    readonly endSessions: boolean;
    readonly update:
      | { readonly role: "admin" | "user" }
      | {
          readonly banExpires: null;
          readonly banned: boolean;
          readonly banReason: string | null;
        };
  },
) =>
  Effect.gen(function* () {
    const attempt = <A>(
      store: "database" | "sessions",
      rowChanged: boolean,
      run: () => Promise<A>,
    ) =>
      Effect.tryPromise({
        catch: (cause) => new PlatformAdminStoreError({ cause, rowChanged, store }),
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
    yield* attempt("database", false, () => internalAdapter.updateUser(userId, update));
    if (endSessions) {
      yield* attempt("sessions", true, () => internalAdapter.deleteUserSessions(userId));
    }
    const after = yield* attempt("sessions", true, async () => {
      const sessions = await internalAdapter.listSessions(userId);
      return Promise.all(sessions.map(({ token }) => internalAdapter.findSession(token)));
    });
    const ended = new Set(endSessions ? open.map(({ token }) => token) : []);
    // After sessions are ended the only ones left were signed in since, and have the change.
    const stale = after.filter(
      (live) =>
        live &&
        (ended.has(live.session.token) ||
          ("role" in update
            ? live.user.role !== update.role
            : (live.user.banned === true) !== update.banned)),
    ).length;
    if (stale > 0) {
      return yield* new PlatformAdminSessionsStale({ stale });
    }
    return {
      sessions: endSessions ? open.length : after.filter((live) => live !== null).length,
    };
  });

/**
 * Grants or removes the platform admin role, the one way it is changed outside
 * better-auth's own `/auth/admin/set-role` (which needs an admin to call it, so cannot make
 * a deployment's first). `/auth/admin/*` authorises on the copy of the user each session
 * holds in Redis, so an update of the user's row alone leaves a removed admin with those
 * endpoints until their sessions end.
 *
 * - A grant rewrites that copy in every session the user has open, so a new admin need not
 *   sign in again.
 * - A removal ends the user's sessions. A rewrite alone can lose to a session renewal or a
 *   sign-in that read the old user and writes it back afterwards; better-auth's deletion
 *   also marks every session made before it as revoked.
 */
export const setPlatformAdmin = (
  auth: Auth,
  { admin, email }: { readonly admin: boolean; readonly email: string },
) =>
  // The two roles better-auth's admin plugin has here; no others are configured.
  changeUser(auth, email, { endSessions: !admin, update: { role: admin ? "admin" : "user" } });

/**
 * Bans a user or lifts their ban, as better-auth's `/auth/admin/ban-user` and `unban-user`
 * do, which need an admin's session. A ban has no expiry and ends the user's sessions:
 * better-auth refuses a banned user only when a session is made, so one left open would
 * keep everything better-auth's own endpoints give it (a Project's API keys among them).
 * Lifting a ban ends nothing; it clears the ban from any session a ban written straight to
 * the database left open.
 */
export const setBanned = (
  auth: Auth,
  { banned, email }: { readonly banned: boolean; readonly email: string },
) =>
  changeUser(auth, email, {
    endSessions: banned,
    update: { banExpires: null, banned, banReason: banned ? "Banned by an operator" : null },
  });

/**
 * Whether Redis holds a session of any user under this key prefix. `setPlatformAdmin` or
 * `setBanned` finding none of one user's sessions is ordinary; a store with none at all, on
 * a deployment anyone is signed in to, is not the api's.
 */
export const hasStoredSessions = (redis: AuthRedis, redisKeyPrefix: string) =>
  Effect.tryPromise({
    // The row is already written by the time this is asked.
    catch: (cause) => new PlatformAdminStoreError({ cause, rowChanged: true, store: "sessions" }),
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
