import type { acceptTransactionalEmail } from "@repo/channels/email/accept";
import { logEffectFailure } from "@repo/logging";
import type { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerError, HttpServerResponse } from "effect/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { Api } from "./api";
import { ApiKeyAuthLive, LegacyApiKeyAuthLive } from "./lib/api-key";
import { RequestValidationLive } from "./lib/validation";
import { legacySendHandlers } from "./routes/compat/send";
import { sendHandlers } from "./routes/messages/email";
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
 * The api's HTTP server: every route, `/docs` and `/openapi.json` generated from `Api`, on
 * Bun. Needs `ApiAuth` and what accept and the SES ingest use; a test passes its own
 * `accept` and `handleSes` to reach every outcome without them.
 */
export const apiServer = (options: {
  readonly hostname: string;
  readonly port: number;
  readonly accept?: typeof acceptTransactionalEmail;
  readonly handleSes?: typeof handleSesNotification;
}) =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }),
      HttpApiScalar.layerCdn(Api, { path: "/docs" }),
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
