import { AUTH_BASE_PATH } from "@repo/persistence/auth/constants";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ApiAuth } from "../lib/auth";

/**
 * better-auth at `/auth/*`: sign-in and sign-up, the session, organizations and their
 * members, the GitHub OAuth callback (`/auth/callback/github`) and
 * Stripe's webhook (`/auth/stripe/webhook`). GitHub and Stripe are configured with those
 * URLs on `API_URL`.
 */
export const authRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const { auth } = yield* ApiAuth;
    yield* router.add("*", `${AUTH_BASE_PATH}/*`, (request) =>
      // better-auth reads a web Request's body itself, with no limit. It is read here, under
      // the limit `bodyLimit` gave this route, and handed over whole; the bytes are the
      // sender's, which Stripe's signature needs.
      Effect.all([HttpServerRequest.toWeb(request), request.arrayBuffer]).pipe(
        Effect.orDie,
        Effect.flatMap(([source, body]) =>
          Effect.promise(() =>
            auth.handler(
              new Request(source.url, {
                body: body.byteLength === 0 ? undefined : body,
                headers: source.headers,
                method: source.method,
                signal: source.signal,
              }),
            ),
          ),
        ),
        Effect.map(HttpServerResponse.fromWeb),
      ),
    );
  }),
);
