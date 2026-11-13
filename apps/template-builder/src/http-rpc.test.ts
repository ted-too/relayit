import { expect, it } from "@effect/vitest";
import { Effect, FiberSet, Layer, Schema } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Rpc, RpcClient, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";

const PingRpcs = RpcGroup.make(
  Rpc.make("ping", {
    success: Schema.String,
  }),
);

const PingLive = PingRpcs.toLayer({
  ping: () => Effect.succeed("pong"),
});

const callPing = (rpcUrl: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(PingRpcs);
      return yield* client.ping();
    }),
  ).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: rpcUrl }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );

const serve = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ fetch, hostname: "127.0.0.1", port: 0 })),
    (server) => Effect.promise(() => server.stop(true)),
  );

it.live("HttpRouter.toWebHandler returns an RPC body", () =>
  Effect.gen(function* () {
    const App = RpcServer.layer(PingRpcs).pipe(
      Layer.provide(PingLive),
      Layer.provide(
        RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
          Layer.provide(RpcSerialization.layerNdjson),
        ),
      ),
    );
    const { dispose, handler } = HttpRouter.toWebHandler(App, {
      disableLogger: true,
    });
    yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
    const server = yield* serve((request) => handler(request));

    const result = yield* callPing(`http://127.0.0.1:${server.port}/rpc`);
    expect(result).toBe("pong");
  }),
);

it.live("per-request scoped toWeb() yields an empty RPC body", () =>
  Effect.gen(function* () {
    const rpcHttpEffect = yield* RpcServer.toHttpEffect(PingRpcs).pipe(
      Effect.provide(Layer.mergeAll(PingLive, RpcSerialization.layerNdjson)),
    );
    const run = yield* FiberSet.makeRuntimePromise();
    const handleRpc = async (request: Request) => {
      const exit = await run(
        Effect.exit(
          rpcHttpEffect.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(request),
            ),
            Effect.scoped,
          ),
        ),
      );
      if (exit._tag === "Success") {
        return HttpServerResponse.toWeb(exit.value);
      }
      return new Response("Internal Rpc failure", { status: 500 });
    };
    const server = yield* serve((request) => {
      if (request.method === "POST" && new URL(request.url).pathname === "/rpc") {
        return handleRpc(request);
      }
      return new Response("Not Found", { status: 404 });
    });

    const error = yield* callPing(`http://127.0.0.1:${server.port}/rpc`).pipe(Effect.flip);
    expect(String(error)).toContain("empty HTTP response");
  }),
);
