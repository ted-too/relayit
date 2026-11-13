import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ApiAuth } from "../lib/auth";

/**
 * better-auth at `/api/auth/*`: sign-in and sign-up, the session, organizations and their
 * members, API key deletion, the GitHub OAuth callback and Stripe's webhook. These URLs are
 * registered with GitHub and Stripe, so the path is fixed.
 */
export const authRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const { auth } = yield* ApiAuth;
    yield* router.add("*", "/api/auth/*", (request) =>
      HttpServerRequest.toWeb(request).pipe(
        Effect.orDie,
        Effect.flatMap((webRequest) => Effect.promise(() => auth.handler(webRequest))),
        Effect.map(HttpServerResponse.fromWeb),
      ),
    );
  }),
);
