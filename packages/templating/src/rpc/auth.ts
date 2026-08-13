import { Effect, Layer, Redacted } from "effect";
import { RpcMiddleware } from "effect/unstable/rpc";
import type { Request } from "effect/unstable/rpc/RpcMessage";
import { BuilderUnauthorized } from "./errors";
import { BuilderAuthMiddleware } from "./group";

const AUTHORIZATION = "authorization";

const bearerMatches = (header: string | undefined, secret: string) =>
  header === `Bearer ${secret}`;

/** Server: reject Rpc calls without a matching Bearer secret. */
export const makeBuilderAuthServerLayer = (secret: Redacted.Redacted<string>) =>
  Layer.succeed(BuilderAuthMiddleware, (effect, { headers }) => {
    const expected = Redacted.value(secret);
    if (bearerMatches(headers[AUTHORIZATION], expected)) {
      return effect;
    }
    return Effect.fail(
      new BuilderUnauthorized({
        message: "Invalid builder credentials.",
      })
    );
  });

const withAuthorization = (
  request: Request<never>,
  secret: string
): Request<never> => ({
  ...request,
  headers: {
    ...request.headers,
    [AUTHORIZATION]: `Bearer ${secret}`,
  },
});

/** Client: attach Bearer secret to every outgoing Rpc request. */
export const makeBuilderAuthClientLayer = (secret: Redacted.Redacted<string>) =>
  RpcMiddleware.layerClient(BuilderAuthMiddleware, ({ next, request }) =>
    next(withAuthorization(request, Redacted.value(secret)))
  );
