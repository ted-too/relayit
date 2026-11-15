import { BunRuntime } from "@effect/platform-bun";
import { Config, Effect, Layer } from "effect";
import { webServer } from "./http";

/** The `relayit-web` image's process: the dashboard's build and its runtime config. */
const config = Config.all({
  // The api's public origin, which the page calls with the session cookie.
  apiUrl: Config.URL("API_URL"),
  hostname: Config.String("HOST").pipe(Config.withDefault("0.0.0.0")),
  port: Config.Port("PORT").pipe(Config.withDefault(3000)),
});

BunRuntime.runMain(
  Layer.launch(
    Layer.unwrap(
      Effect.gen(function* () {
        const options = yield* config;
        yield* Effect.logInfo(
          `Relayit dashboard on ${options.hostname}:${options.port}, calling ${options.apiUrl.origin}`,
        );
        // The build, relative to the working directory: apps/web in the repo, /app in the image.
        return webServer({ ...options, root: "dist" });
      }),
    ),
  ),
);
