import { Config, Effect, Layer, Logger, type LogLevel, References } from "effect";

/** JSON lines under NODE_ENV=production, readable lines otherwise. */
export const loggingLive = (logLevel: LogLevel.LogLevel) =>
  Layer.mergeAll(
    Logger.layer([
      Bun.env.NODE_ENV === "production" ? Logger.consoleJson : Logger.consolePretty(),
      Logger.tracerLogger,
    ]),
    Layer.succeed(References.MinimumLogLevel, logLevel),
  );

// Reads only LOG_LEVEL, so the rest of an app's config fails inside its program, where it is
// logged and exits non-zero, rather than while the logger is built, silently.
export const LoggingLive = Layer.unwrap(
  Effect.map(Config.logLevel("LOG_LEVEL").pipe(Config.withDefault("Info")), loggingLive),
);
