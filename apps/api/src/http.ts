import type { acceptTransactionalEmail } from "@repo/channels/email/accept";
import type { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import { logEffectFailure } from "@repo/logging";
import type { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerError, HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { Api } from "./api";
import { dashboardRoutes } from "./dashboard/http";
import { ApiKeyAuthLive, LegacyApiKeyAuthLive } from "./lib/api-key";
import { RequestValidationLive } from "./lib/validation";
import { authRoutes } from "./routes/auth";
import { dashboardAppRoutes } from "./routes/dashboard-app";
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
 * The api's HTTP server on Bun: the public routes, with `/docs` and `/openapi.json`
 * generated from `Api`; better-auth at `/api/auth/*`; the dashboard's operations under
 * `/api/dashboard`; one-click unsubscribe; and, from `dashboardDir`, the dashboard itself. Needs `ApiAuth` and what the routes use; a
 * test passes its own `accept`, `handleSes` and `unsubscribe` to reach every outcome
 * without them.
 */
export const apiServer = (options: {
  readonly hostname: string;
  readonly port: number;
  readonly dashboard: Parameters<typeof dashboardRoutes>[0];
  /** The dashboard's build; development serves it from Vite instead. */
  readonly dashboardDir?: string;
  /** The current better-auth secret, which signs unsubscribe links. */
  readonly unsubscribeSecret: string;
  readonly accept?: typeof acceptTransactionalEmail;
  readonly handleSes?: typeof handleSesNotification;
  readonly unsubscribe?: typeof handleListUnsubscribeOneClick;
}) =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }),
      HttpApiScalar.layerCdn(Api, { path: "/docs" }),
      dashboardRoutes(options.dashboard),
      authRoutes,
      unsubscribeRoutes({ handle: options.unsubscribe, secret: options.unsubscribeSecret }),
      options.dashboardDir === undefined ? Layer.empty : dashboardAppRoutes(options.dashboardDir),
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
    // Bun's own idle timeout, which the api ran with before; the layer's default is none.
    Layer.provideMerge(
      BunHttpServer.layer({ hostname: options.hostname, idleTimeout: 10, port: options.port }),
    ),
  );
