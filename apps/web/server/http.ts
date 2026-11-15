import * as NodePath from "node:path";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerError, HttpServerResponse, HttpStaticServer } from "effect/http";

// Every route of the dashboard answers with the same page, so nothing it serves may be
// framed or sniffed as another type.
const SECURITY_HEADERS = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/**
 * The dashboard's server, all the `relayit-web` image runs. It serves the build in `root`
 * (`apps/web/dist`) and `/config.js`, which tells the page where the api is: `apiUrl`, read
 * from the container's `API_URL` when it starts, so one published image serves any
 * deployment. `index.html` loads it before the app.
 *
 * A GET for a file in the build gets the file; any other path a browser asks for as HTML
 * (`Accept: text/html`) gets `index.html`, for the dashboard's router to resolve. A path
 * may have a dot in it (`/acme/domains/mail.example.com`), so the extension decides
 * nothing. Anything else is a 404. Vite names everything in `assets/` after its content,
 * so those are cached for good; the rest, `index.html` and `config.js` above all, is
 * revalidated on every load.
 */
export const webServer = (options: {
  readonly apiUrl: URL;
  readonly hostname: string;
  readonly port: number;
  readonly root: string;
}) =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/config.js",
        HttpServerResponse.text(
          `window.RELAYIT_CONFIG = ${JSON.stringify({ apiUrl: options.apiUrl.origin })};\n`,
          {
            contentType: "text/javascript; charset=utf-8",
            headers: { ...SECURITY_HEADERS, "Cache-Control": "no-cache" },
          },
        ),
      ),
      HttpRouter.use((router) =>
        Effect.gen(function* () {
          const serve = yield* HttpStaticServer.make({ root: options.root });
          const index = NodePath.join(options.root, "index.html");
          yield* router.add("GET", "/*", (request) =>
            serve.pipe(
              Effect.catchIf(
                (error) =>
                  error.reason._tag === "RouteNotFound" &&
                  (request.headers.accept ?? "").includes("text/html"),
                () =>
                  HttpServerResponse.file(index, { contentType: "text/html; charset=utf-8" }).pipe(
                    Effect.orDie,
                  ),
              ),
              Effect.map((response) =>
                HttpServerResponse.setHeaders(response, {
                  ...SECURITY_HEADERS,
                  "Cache-Control":
                    response.status === 200 && request.url.startsWith("/assets/")
                      ? "public, max-age=31536000, immutable"
                      : "no-cache",
                }),
              ),
            ),
          );
        }),
      ),
      HttpRouter.middleware(
        (httpEffect) =>
          httpEffect.pipe(
            Effect.catchIf(
              (error) =>
                HttpServerError.isHttpServerError(error) && error.reason._tag === "RouteNotFound",
              () =>
                Effect.succeed(
                  HttpServerResponse.text("Not found", { headers: SECURITY_HEADERS, status: 404 }),
                ),
            ),
          ),
        { global: true },
      ),
    ),
    { disableListenLog: true, disableLogger: true },
  ).pipe(
    Layer.provideMerge(BunHttpServer.layer({ hostname: options.hostname, port: options.port })),
  );
