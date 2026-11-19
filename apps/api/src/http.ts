import type { acceptTransactionalEmail } from "@repo/channels/email/accept";
import { ATTACHMENTS_DEADLINE_SECONDS } from "@repo/channels/email/attachment-policy";
import type { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import { logEffectFailure } from "@repo/logging";
import type { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import {
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  HttpServerError,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { Api, MAX_SEND_BODY_BYTES } from "./api";
import { dashboardRoutes } from "./dashboard/http";
import { EmailWorkspaceEditing } from "./dashboard/workspaces";
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
 *
 * Whatever is answered, by a route, by its middleware or here, closes the connection when
 * the request had a body and none of it was read: a send refused for its key, a body
 * refused by its `Content-Length`, a 404. Bun stops reading a body nobody consumes, and the
 * connection then waits on it until the idle timeout, holding a graceful shutdown with it.
 * It is a pre-response handler rather than a `map` so that the server's own 500 is covered.
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
      HttpEffect.withPreResponseHandler((request, response) =>
        Effect.succeed(
          // Bun's request is a web `Request`; anything else has no body to tell about.
          request.source instanceof Request &&
            request.source.body !== null &&
            !request.source.bodyUsed
            ? HttpServerResponse.setHeader(response, "connection", "close")
            : response,
        ),
      ),
    ),
  { global: true },
);

/**
 * CORS for the dashboard, which runs on its own origin (`APP_URL`) and calls the api with
 * the session cookie: that origin alone is granted, with credentials, and preflights are
 * answered. Another origin gets no `Access-Control-Allow-Origin`, so a browser keeps the
 * response from it. It is for exactly the routes the dashboard calls (the `DashboardApi`,
 * better-auth, unsubscribe), rather than matched on paths: the public API is never given
 * it, sends no CORS headers, and its preflight stays a 404, since it is called by servers
 * holding an API key, never from a page.
 */
const dashboardCors = (appOrigin: string) =>
  HttpMiddleware.cors({
    allowedOrigins: (origin) => origin === appOrigin,
    credentials: true,
    maxAge: 600,
  });

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
  /** What the dashboard's `GET /config` reports; `emailWorkspaceEditing` off also freezes Email Workspaces. */
  readonly dashboard: {
    readonly billing: boolean;
    readonly emailWorkspaceEditing: boolean;
    readonly githubSignIn: boolean;
  };
  /** Every better-auth secret, current first, any of which may have signed an unsubscribe link. */
  readonly unsubscribeSecrets: ReadonlyArray<string>;
  readonly accept?: typeof acceptTransactionalEmail;
  readonly handleSes?: typeof handleSesNotification;
  readonly unsubscribe?: typeof handleListUnsubscribeOneClick;
}) =>
  HttpRouter.serve(
    // Every route is in one of these two groups, and so behind `bodyLimit`: a route added
    // to either is limited too. The dashboard's routes get CORS around the limit, composed
    // as one function, because the router does not promise an order between two route
    // middlewares provided apart, and a `413` given inside the limit has to come back
    // through CORS for the page to be allowed to read it.
    Layer.mergeAll(
      Layer.mergeAll(
        HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }),
        HttpApiScalar.layerCdn(Api, { path: "/docs" }),
      ).pipe(Layer.provide(HttpRouter.middleware(bodyLimit).layer)),
      Layer.mergeAll(
        dashboardRoutes({ ...options.dashboard, appOrigin: options.appOrigin }),
        authRoutes,
        unsubscribeRoutes({
          appOrigin: options.appOrigin,
          handle: options.unsubscribe,
          secrets: options.unsubscribeSecrets,
        }),
      ).pipe(
        Layer.provide(
          HttpRouter.middleware((httpEffect) =>
            dashboardCors(options.appOrigin)(bodyLimit(httpEffect)),
          ).layer,
        ),
      ),
      fallback,
    ).pipe(
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
    Layer.provide(Layer.succeed(EmailWorkspaceEditing, options.dashboard.emailWorkspaceEditing)),
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
