import * as NodePath from "node:path";
import { Effect } from "effect";
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";

/**
 * Paths that are the api's own. An unknown one keeps the `404 NOT_FOUND` the public API
 * answers with, rather than the dashboard's page, whatever the request accepts.
 */
const API_PATHS = /^\/(api|messages|send|webhooks|health|docs|openapi\.json)(\/|$)/;

// The dashboard's page is the same for every route, so nothing on it may be framed or
// sniffed as another type.
const SECURITY_HEADERS = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/**
 * The dashboard's build (`apps/web/dist`), served from `root` for any GET the api doesn't
 * route: a file that exists is served as it is, and any other path from a browser asking
 * for HTML (`Accept: text/html`) gets `index.html`, for the dashboard's router to resolve.
 * A path may have a dot in it (`/acme/domains/mail.example.com`), so whether it names a
 * file is not judged by its extension. Anything else is the api's `404 NOT_FOUND`. Vite
 * names everything in `assets/` after its content, so those are cached for good; the rest,
 * `index.html` above all, is revalidated on every load.
 */
export const dashboardAppRoutes = (root: string) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const serve = yield* HttpStaticServer.make({ root });
      const index = NodePath.join(root, "index.html");
      yield* router.add("GET", "/*", (request) =>
        Effect.gen(function* () {
          const url = HttpServerRequest.toURL(request);
          const path = url._tag === "Some" ? url.value.pathname : "/";
          if (API_PATHS.test(path)) {
            return yield* new HttpServerError.HttpServerError({
              reason: new HttpServerError.RouteNotFound({ request }),
            });
          }
          const response = yield* serve.pipe(
            Effect.catchIf(
              (error) =>
                error.reason._tag === "RouteNotFound" &&
                (request.headers.accept ?? "").includes("text/html"),
              () =>
                HttpServerResponse.file(index, { contentType: "text/html; charset=utf-8" }).pipe(
                  Effect.orDie,
                ),
            ),
          );
          return HttpServerResponse.setHeaders(response, {
            ...SECURITY_HEADERS,
            "Cache-Control":
              response.status === 200 && path.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "no-cache",
          });
        }),
      );
    }),
  );
