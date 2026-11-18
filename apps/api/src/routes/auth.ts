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
      HttpServerRequest.toWeb(request).pipe(
        Effect.orDie,
        Effect.flatMap((webRequest) => Effect.promise(() => auth.handler(webRequest))),
        Effect.map(HttpServerResponse.fromWeb),
      ),
    );
  }),
);
