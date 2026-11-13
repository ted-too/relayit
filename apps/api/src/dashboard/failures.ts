import { Conflict, Invalid, NotFound, OperationFailed } from "@repo/contracts/dashboard";
import { logEffectFailure } from "@repo/logging";
import { APIError } from "@repo/persistence/auth/server";
import { Cause, Data, Effect } from "effect";

/**
 * A failure the dashboard can't act on: logged with its cause, answered with a 500 that
 * says only `message`.
 */
export const operationFailed =
  (message: string) =>
  (cause: unknown): Effect.Effect<never, OperationFailed> =>
    logEffectFailure(message)(Cause.fail(cause)).pipe(
      Effect.andThen(Effect.fail(new OperationFailed({ message }))),
    );

/** A better-auth endpoint threw: an `APIError` refusal or something unexpected. */
class AuthCallFailed extends Data.TaggedError("AuthCallFailed")<{ readonly cause: unknown }> {}

/**
 * A better-auth endpoint called as the user: its refusals keep their message, as the
 * dashboard showed them before; anything else is ours.
 */
export const callAuth = <A>(
  message: string,
  call: () => Promise<A>,
): Effect.Effect<A, Conflict | Invalid | NotFound | OperationFailed> =>
  Effect.tryPromise({ catch: (cause) => new AuthCallFailed({ cause }), try: call }).pipe(
    Effect.catch(
      ({ cause }): Effect.Effect<never, Conflict | Invalid | NotFound | OperationFailed> => {
        if (!(cause instanceof APIError)) {
          return operationFailed(message)(cause);
        }
        const refusal = cause.body?.message ?? cause.message;
        switch (cause.statusCode) {
          case 400:
          case 422:
            return Effect.fail(new Invalid({ message: refusal }));
          case 401:
          case 403:
          case 404:
            return Effect.fail(new NotFound({ message: refusal }));
          case 409:
            return Effect.fail(new Conflict({ message: refusal }));
          default:
            return operationFailed(message)(cause);
        }
      },
    ),
  );
