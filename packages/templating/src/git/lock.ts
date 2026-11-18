import { Redis } from "@repo/redis";
import { type Duration, Effect, Schedule } from "effect";
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
 * A held lock fails with TemplatingBuilderError code `"busy"`: at once by default, so a
 * write is never queued behind another, or only after polling for `waitFor`.
 */
export const withWorkspaceGitLock = <A, E, R>(
  workspaceId: string,
  effect: Effect.Effect<A, E, R>,
  options?: { readonly waitFor: Duration.Input },
): Effect.Effect<A, E | TemplatingBuilderError, R | Redis> =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const key = lockKey(workspaceId);
    const token = crypto.randomUUID();

    const acquire = redis
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
            }),
        ),
        Effect.filterOrFail(
          (acquired) => acquired === 1,
          () =>
            new TemplatingBuilderError({
              code: "busy",
              message: "Workspace is busy; retry shortly.",
            }),
        ),
      );
    yield* options
      ? acquire.pipe(
          Effect.retry({
            schedule: Schedule.spaced("100 millis").pipe(
              Schedule.upTo({ duration: options.waitFor }),
            ),
            while: (error) => error.code === "busy",
          }),
        )
      : acquire;

    return yield* effect.pipe(
      Effect.ensuring(
        redis
          .evaluateNumber({
            args: [token],
            keys: [key],
            script: RELEASE_SCRIPT,
          })
          .pipe(Effect.ignore),
      ),
    );
  });
