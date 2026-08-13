import { TemplatingBuilderRpcs } from "@repo/templating";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { templateBuilderConfig } from "./env";
import { makeAppLayers } from "./layers";

const program = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* templateBuilderConfig;
    const appLayers = makeAppLayers(config);

    const rpcHttpEffect = yield* RpcServer.toHttpEffect(
      TemplatingBuilderRpcs
    ).pipe(
      Effect.provide(Layer.mergeAll(appLayers, RpcSerialization.layerNdjson))
    );

    const hostname = config.hostname;
    const port = config.port;

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname,
          port,
          fetch: async (request) => {
            const url = new URL(request.url);
            if (request.method === "GET" && url.pathname === "/health") {
              return Response.json({
                role: "template-builder",
                status: "ok",
              });
            }

            if (request.method === "POST" && url.pathname === "/rpc") {
              const exit = await Effect.runPromiseExit(
                rpcHttpEffect.pipe(
                  Effect.provideService(
                    HttpServerRequest.HttpServerRequest,
                    HttpServerRequest.fromWeb(request)
                  ),
                  Effect.scoped
                )
              );

              if (Exit.isSuccess(exit)) {
                return HttpServerResponse.toWeb(exit.value);
              }

              return new Response(
                JSON.stringify({ error: "Internal Rpc failure" }),
                {
                  headers: { "content-type": "application/json" },
                  status: 500,
                }
              );
            }

            return new Response("Not Found", { status: 404 });
          },
        })
      ),
      (server) =>
        Effect.sync(() => {
          server.stop(true);
        })
    );

    yield* Effect.logInfo(
      `template-builder listening on http://${hostname}:${port} (rpc at /rpc)`
    );
    return yield* Effect.never;
  })
);

Effect.runFork(
  program.pipe(Effect.tapCause((cause) => Effect.logError(Cause.pretty(cause))))
);
