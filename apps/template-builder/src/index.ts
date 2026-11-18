import { LoggingLive, logEffectFailure } from "@repo/logging";
import { migrateOnStartup } from "@repo/persistence/db/migrate";
import { TemplatingBuilderRpcs } from "@repo/templating";
import { Cause, Effect, Layer, Redacted } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { templateBuilderConfig } from "./env";
import { makeAppLayers } from "./layers";

const program = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* templateBuilderConfig;
    yield* Effect.promise(() => migrateOnStartup(Redacted.value(config.databaseUrl)));
    yield* Effect.logInfo("Database migrations up to date");

    const httpApp = Layer.mergeAll(
      RpcServer.layer(TemplatingBuilderRpcs).pipe(
        Layer.provide(makeAppLayers(config)),
        Layer.provide(
          RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
            Layer.provide(RpcSerialization.layerNdjson),
          ),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/health",
        HttpServerResponse.jsonUnsafe({
          role: "template-builder",
          status: "ok",
        }),
      ),
    );

    const { dispose, handler } = HttpRouter.toWebHandler(httpApp);
    yield* Effect.promise(() => handler(new Request("http://127.0.0.1/health")));

    const hostname = config.hostname;
    const port = config.port;

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          fetch: (request) => handler(request),
          hostname,
          // Bun's server drops a connection that has been idle for 10 seconds by default,
          // and on Bun 1.4.4 a plain handler that takes 13 seconds to answer is cut that
          // way. A first read that waits out another's scaffold, or a publish that installs
          // dependencies, can run longer, so no call here should depend on that default.
          // 255 is Bun's maximum.
          idleTimeout: 255,
          port,
        }),
      ),
      (server) =>
        Effect.promise(async () => {
          server.stop(true);
          await dispose();
        }),
    );

    yield* Effect.logInfo(`template-builder listening on http://${hostname}:${port} (rpc at /rpc)`);
    return yield* Effect.never;
  }),
);

const reportFailure = Effect.catchCause((cause) => {
  if (cause.reasons.every(Cause.isInterruptReason)) {
    return Effect.void;
  }

  return logEffectFailure("Process failed")(cause).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    ),
  );
});

Effect.runFork(program.pipe(reportFailure, Effect.provide(LoggingLive)));
