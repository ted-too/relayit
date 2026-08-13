import { expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc";

const PingRpcs = RpcGroup.make(
  Rpc.make("ping", {
    success: Schema.String,
  })
);

const PingLive = PingRpcs.toLayer({
  ping: () => Effect.succeed("pong"),
});

const callPing = (rpcUrl: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(PingRpcs);
      return yield* client.ping();
    })
  ).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: rpcUrl }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer)
      )
    )
  );

test("HttpRouter.toWebHandler returns an RPC body", async () => {
  const App = RpcServer.layer(PingRpcs).pipe(
    Layer.provide(PingLive),
    Layer.provide(
      RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
        Layer.provide(RpcSerialization.layerNdjson)
      )
    )
  );
  const { dispose, handler } = HttpRouter.toWebHandler(App, {
    disableLogger: true,
  });
  const server = Bun.serve({
    fetch: (request) => handler(request),
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const result = await Effect.runPromise(
      callPing(`http://127.0.0.1:${server.port}/rpc`)
    );
    expect(result).toBe("pong");
  } finally {
    server.stop(true);
    await dispose();
  }
});

test("per-request scoped toWeb() yields an empty RPC body", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const rpcHttpEffect = yield* RpcServer.toHttpEffect(PingRpcs).pipe(
          Effect.provide(
            Layer.mergeAll(PingLive, RpcSerialization.layerNdjson)
          )
        );
        const handleRpc = async (request: Request) => {
          const exit = await Effect.runPromiseExit(
            rpcHttpEffect.pipe(
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                HttpServerRequest.fromWeb(request)
              ),
              Effect.scoped
            )
          );
          if (exit._tag === "Success") {
            return HttpServerResponse.toWeb(exit.value);
          }
          return new Response("Internal Rpc failure", { status: 500 });
        };
        const server = Bun.serve({
          fetch: (request) => {
            if (
              request.method === "POST" &&
              new URL(request.url).pathname === "/rpc"
            ) {
              return handleRpc(request);
            }
            return new Response("Not Found", { status: 404 });
          },
          hostname: "127.0.0.1",
          port: 0,
        });
        try {
          const error = yield* callPing(
            `http://127.0.0.1:${server.port}/rpc`
          ).pipe(Effect.flip);
          expect(String(error)).toContain("empty HTTP response");
        } finally {
          server.stop(true);
        }
      })
    )
  );
});
