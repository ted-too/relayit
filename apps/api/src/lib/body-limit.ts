import { DashboardApi } from "@repo/contracts/dashboard";
import { ByteSize, Effect } from "effect";
import {
  HttpIncomingMessage,
  HttpRouter,
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
 * before the route (its session check included) runs. A body without one (chunked) is read
 * here, up to the limit, before the route runs, and is a `413` once it passes it; the route
 * then reads the same bytes from the request's cache, under the same limit. Reading it here
 * rather than leaving it to the route is what makes the answer the same on every route:
 * one that reads no body, one that hands the request to better-auth, and one whose
 * contract has no `413` to answer a failed read with.
 *
 * The `413` closes the connection. Bun stops reading a body nobody consumes, and the
 * connection then waits on it until the idle timeout, holding a graceful shutdown with it.
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
      { headers: { connection: "close" }, status: 413 },
    );
    const announced = request.headers["content-length"];
    if (announced !== undefined && !(Number(announced) <= limit)) {
      return tooLarge;
    }
    return yield* Effect.gen(function* () {
      if (announced === undefined) {
        const read = yield* Effect.result(request.arrayBuffer);
        if (read._tag === "Failure") {
          const { reason } = read.failure;
          if (reason._tag === "RequestParseError" && reason.reason === "BodyTooLarge") {
            return tooLarge;
          }
          return yield* read.failure;
        }
      }
      return yield* httpEffect;
    }).pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.fromInputUnsafe(limit)),
    );
  }),
).layer;
