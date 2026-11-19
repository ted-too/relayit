import type { acceptTransactionalEmail } from "@repo/channels/email/accept";
import { ATTACHMENTS_DEADLINE_SECONDS } from "@repo/channels/email/attachment-policy";
import type { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import { logEffectFailure } from "@repo/logging";
import type { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter, HttpServerError, HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { Api, MAX_SEND_BODY_BYTES } from "./api";
import { dashboardRoutes } from "./dashboard/http";
import { ApiKeyAuthLive, LegacyApiKeyAuthLive } from "./lib/api-key";
import { bodyLimit } from "./lib/body-limit";
import { RequestValidationLive } from "./lib/validation";
import { authRoutes } from "./routes/auth";
import { legacySendHandlers } from "./routes/compat/send";
import { sendHandlers } from "./routes/messages/email";
import { unsubscribeRoutes } from "./routes/unsubscribe";
import { sesNotificationHandlers } from "./routes/webhooks/ses";

const healthHandlers = HttpApiBuilder.group(Api, "health", (handlers) =>
  Effect.succeed(handlers.handle("health", () => Effect.succeed({ status: "ok" as const }))),
);

/**
 * In front of every route: a request no route matches gets the `404 NOT_FOUND` the api
 * has always answered with, and a failure no route turned into a response is logged
 * before the server answers 500.
 */
const fallback = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.catchIf(
        (error) =>
          HttpServerError.isHttpServerError(error) && error.reason._tag === "RouteNotFound",
        () =>
          Effect.succeed(
            HttpServerResponse.text("NOT_FOUND", {
              contentType: "text/plain;charset=utf-8",
              status: 404,
            }),
          ),
      ),
      Effect.tapCause(logEffectFailure("API request failed")),
    ),
  { global: true },
);

/**
 * CORS for the dashboard, which runs on its own origin (`APP_URL`) and calls the api with
 * the session cookie: that origin alone is granted, with credentials, and preflights are
 * answered. Another origin gets no `Access-Control-Allow-Origin`, so a browser keeps the
 * response from it. It is route middleware, given to exactly the routes the dashboard calls
 * (the `DashboardApi`, better-auth, unsubscribe) where they are built, rather than matched
 * on paths: the public API is never given it, sends no CORS headers, and its preflight stays
 * a 404, since it is called by servers holding an API key, never from a page.
 */
const dashboardCors = (appOrigin: string) =>
  HttpRouter.middleware(
    HttpMiddleware.cors({
      allowedOrigins: (origin) => origin === appOrigin,
      credentials: true,
      maxAge: 600,
    }),
  ).layer;

/**
 * The api's HTTP server on Bun: the public routes, with `/docs` and `/openapi.json`
 * generated from `Api`; better-auth at `/auth/*`; the dashboard's operations
 * (`DashboardApi`) at their own root paths; and one-click unsubscribe. `appOrigin` is the dashboard's origin, the one
 * CORS grants. Needs `ApiAuth` and what the routes use; a test passes its own `accept`,
 * `handleSes` and `unsubscribe` to reach every outcome without them.
 */
export const apiServer = (options: {
  readonly hostname: string;
  readonly port: number;
  readonly appOrigin: string;
  /** What the dashboard's `GET /config` reports. */
  readonly dashboard: { readonly billing: boolean; readonly githubSignIn: boolean };
  /** Every better-auth secret, current first, any of which may have signed an unsubscribe link. */
  readonly unsubscribeSecrets: ReadonlyArray<string>;
  readonly accept?: typeof acceptTransactionalEmail;
  readonly handleSes?: typeof handleSesNotification;
  readonly unsubscribe?: typeof handleListUnsubscribeOneClick;
}) =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }),
      HttpApiScalar.layerCdn(Api, { path: "/docs" }),
      Layer.mergeAll(
        dashboardRoutes({ ...options.dashboard, appOrigin: options.appOrigin }),
        authRoutes,
        unsubscribeRoutes({
          appOrigin: options.appOrigin,
          handle: options.unsubscribe,
          secrets: options.unsubscribeSecrets,
        }),
      ).pipe(Layer.provide(dashboardCors(options.appOrigin))),
      fallback,
    ).pipe(
      // Around every route above, so that one added there is limited too.
      Layer.provide(bodyLimit),
      Layer.provide(
        Layer.mergeAll(
          healthHandlers,
          sendHandlers(options.accept),
          legacySendHandlers(options.accept),
          sesNotificationHandlers(options.handleSes),
        ),
      ),
      // provideMerge: building the routes resolves the middleware as well as the handlers.
      Layer.provideMerge(
        Layer.mergeAll(RequestValidationLive, ApiKeyAuthLive, LegacyApiKeyAuthLive),
      ),
    ),
    {
      // The api has never logged each request; a failure is logged where it is handled.
      disableListenLog: true,
      disableLogger: true,
      // Paths match case-sensitively and the trailing slash is optional; a doubled slash is
      // not.
      routerConfig: {
        caseSensitive: true,
        ignoreDuplicateSlashes: false,
        ignoreTrailingSlash: true,
      },
    },
  ).pipe(
    // Bun closes a connection idle this long, by its documentation even while the route
    // is still answering. A send may spend `ATTACHMENTS_DEADLINE_SECONDS` on its
    // attachments, then up to 30 seconds more on the rest of accept (the sender and
    // suppression checks, Usage, staging up to the attachments' total in object storage,
    // the transaction), so the connection outlives both and a send that runs out of time
    // still gets its JSON answer.
    // Bun's body limit is a backstop behind `bodyLimit` and the routes' own limits: above it
    // Bun answers an empty 413 before any route runs. It sits above the send endpoints'
    // limit, the largest, so that they answer theirs, `PayloadTooLarge`, themselves.
    Layer.provideMerge(
      BunHttpServer.layer({
        hostname: options.hostname,
        idleTimeout: ATTACHMENTS_DEADLINE_SECONDS + 30,
        maxRequestBodySize: 2 * MAX_SEND_BODY_BYTES,
        port: options.port,
      }),
    ),
  );
