import { DashboardApi } from "@repo/contracts/dashboard";
import { ByteSize, Cause, Effect } from "effect";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApi } from "effect/http-api";
import { Api } from "../api";

/**
 * The most body a route reads unless it is named below. What the dashboard, better-auth
 * (sign-in, sign-up, organizations) and the unsubscribe link carry is a few KB of JSON or a
 * form; the largest legitimate body under it is a Stripe webhook event, which Stripe does
 * not bound but which is tens of KB for the subscription and invoice events it sends here.
 */
export const DEFAULT_BODY_BYTES = 1024 * 1024;

/**
 * The routes that are not held to `DEFAULT_BODY_BYTES`, by their contract's group and
 * endpoint: a number is the route's own limit, enforced here the same way; `"own"` is a
 * route that limits its body itself because it answers differently, and is left alone.
 *
 * A route is found by its endpoint's method and path, which is what `HttpApiBuilder`
 * registers as long as every `:param` in the path is declared and followed by `/` or the
 * end. For a path it rewrites, the name below would match and the limit would not apply,
 * so each entry's limit is pinned by a test (`body-limit.test.ts`, `contract.test.ts`).
 */
const exceptions: Record<string, number | "own"> = {
  // 50 MiB, after the API key and as the customer contract's `413` (`validation.ts`).
  "legacySend.sendRawEmail": "own",
  "legacySend.sendTemplateEmail": "own",
  "send.sendEmail": "own",
  // 1 MiB, as the `400` SNS does not retry (`routes/webhooks/ses.ts`).
  "sesNotifications.receive": "own",
  // A commit carries the whole content of every file it changes, and an Email Workspace's
  // source is a handful of React Email components plus its package.json and lockfile.
  "workspaces.createCommit": 10 * 1024 * 1024,
};

const limits = new Map<string, number | "own">();
const unmatched = new Set(Object.keys(exceptions));
const onEndpoint = ({
  endpoint,
  group,
}: {
  readonly endpoint: {
    readonly identifier: string;
    readonly method: string;
    readonly path: string;
  };
  readonly group: { readonly identifier: string };
}) => {
  const name = `${group.identifier}.${endpoint.identifier}`;
  const limit = exceptions[name];
  if (limit !== undefined) {
    limits.set(`${endpoint.method} ${endpoint.path}`, limit);
    unmatched.delete(name);
  }
};
HttpApi.reflect(Api, { onEndpoint, onGroup: () => undefined });
HttpApi.reflect(DashboardApi, { onEndpoint, onGroup: () => undefined });
if (unmatched.size > 0) {
  // A renamed endpoint would otherwise fall back to the default without anyone noticing.
  throw new Error(`Body limit exceptions name no endpoint: ${[...unmatched].join(", ")}`);
}

/**
 * Holds every route it is given to a body limit: `DEFAULT_BODY_BYTES` unless the route is
 * named in `exceptions`. `http.ts` gives it to all of the api's routes at once, so a route
 * added there later is limited without anyone asking for it.
 *
 * A body over the limit by its `Content-Length` is a `413` before any of it is read and
 * before the route (its session check included) runs. A body without one (chunked) is
 * never read here: the route runs under `MaxBodySize`, so whoever reads the body (the
 * contract's payload decoding, after the session check; `routes/auth.ts` for better-auth)
 * stops once it passes the limit, and that failed read is answered with the same `413`
 * here. `HttpApi` and `routes/auth.ts` die on a failed read, so it is looked for among the
 * defects too. A route that reads no body reads none of a chunked one either. The limit
 * does not reach `request.stream` or a multipart read: a route that takes one caps it
 * itself and is named `"own"`.
 *
 * The `413` closes the connection, and so does any answer a route gives without reading
 * the body it was sent. Bun stops reading a body nobody consumes, and the connection then
 * waits on it until the idle timeout, holding a graceful shutdown with it.
 */
export const bodyLimit = HttpRouter.middleware((httpEffect) =>
  Effect.gen(function* () {
    const { route } = yield* HttpRouter.RouteContext;
    const limit = limits.get(`${route.method} ${route.path}`) ?? DEFAULT_BODY_BYTES;
    if (limit === "own") {
      return yield* httpEffect;
    }
    const request = yield* HttpServerRequest.HttpServerRequest;
    const tooLarge = HttpServerResponse.jsonUnsafe(
      {
        code: "payload_too_large",
        message: `Request body exceeds the ${limit / 1024 / 1024} MiB limit.`,
      },
      {
        contentType: "application/json;charset=utf-8",
        headers: { connection: "close" },
        status: 413,
      },
    );
    const announced = request.headers["content-length"];
    if (announced !== undefined && !(Number(announced) <= limit)) {
      return tooLarge;
    }
    const source = yield* HttpServerRequest.toWeb(request);
    return yield* httpEffect.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.fromInputUnsafe(limit)),
      // An answer given with the body unread closes the connection too, for the same reason.
      Effect.map((response) =>
        source.body === null || source.bodyUsed
          ? response
          : HttpServerResponse.setHeader(response, "connection", "close"),
      ),
      Effect.catchCauseIf(
        (cause) =>
          cause.reasons.some((reason) => {
            const raised = Cause.isFailReason(reason)
              ? reason.error
              : Cause.isDieReason(reason)
                ? reason.defect
                : undefined;
            return (
              HttpServerError.isHttpServerError(raised) &&
              raised.reason._tag === "RequestParseError" &&
              raised.reason.reason === "BodyTooLarge"
            );
          }),
        () => Effect.succeed(tooLarge),
      ),
    );
  }),
).layer;
