import { Redis } from "@repo/redis";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";

/** Publish / deps sync can run longer than a short edit lock. */
const LOCK_TTL_SECONDS = 300;

const ACQUIRE_SCRIPT = `
if redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then
  return 1
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const lockKey = (workspaceId: string) => `templating:git-lock:${workspaceId}`;

/**
 * Exclusive workspace Git lock via Redis Lua (NX + TTL).
 * Contended lock fails with TemplatingBuilderError code `"busy"`.
 */
export const withWorkspaceGitLock = <A, E, R>(
  workspaceId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | TemplatingBuilderError, R | Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const key = lockKey(workspaceId);
    const token = crypto.randomUUID();

    const acquired = yield* redis
      .evaluateNumber({
        args: [token, String(LOCK_TTL_SECONDS)],
        keys: [key],
        script: ACQUIRE_SCRIPT,
      })
      .pipe(
        Effect.mapError(
          () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to acquire workspace lock.",
            })
        )
      );

    if (acquired !== 1) {
      return yield* new TemplatingBuilderError({
        code: "busy",
        message: "Workspace is busy; retry shortly.",
      });
    }

    return yield* effect.pipe(
      Effect.ensuring(
        redis
          .evaluateNumber({
            args: [token],
            keys: [key],
            script: RELEASE_SCRIPT,
          })
          .pipe(Effect.ignore)
      )
    );
  });
