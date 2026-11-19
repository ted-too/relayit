import {
  Cause,
  Config,
  Effect,
  Layer,
  Logger,
  LogLevel,
  References,
  Schema,
  SchemaTransformation,
} from "effect";
import { failureAnnotations } from "./log-failure";

/**
 * `LOG_LEVEL`, `Info` when unset. Read in any case: most tools spell their levels `info`,
 * and Effect's own `Config.LogLevel` takes only `Info`.
 */
export const logLevelConfig = Config.schema(
  Schema.String.pipe(
    Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()),
    Schema.decodeTo(Schema.String, SchemaTransformation.capitalize()),
    Schema.decodeTo(Schema.Literals(LogLevel.values)),
  ),
  "LOG_LEVEL",
).pipe(Config.withDefault("Info"));

/** JSON lines under NODE_ENV=production, readable lines otherwise. */
const logger = Logger.layer([
  Bun.env.NODE_ENV === "production" ? Logger.consoleJson : Logger.consolePretty(),
  Logger.tracerLogger,
]);

export const loggingLive = (logLevel: LogLevel.LogLevel) =>
  Layer.mergeAll(logger, Layer.succeed(References.MinimumLogLevel, logLevel));

/**
 * A process's whole program as its entrypoint forks it: under the app logger at `LOG_LEVEL`,
 * with a failure logged as `failure` and the exit code set to 1.
 *
 * Nothing that can fail is outside the handler. A fiber that fails where no one is
 * listening ends the process with exit 0 and no output, which is what a `LOG_LEVEL` the
 * logger refused once did; so the level is read inside the handler, and only the logger
 * itself, which cannot fail to build, is provided around it.
 */
export const logged =
  (failure: string) =>
  <A, E>(program: Effect.Effect<A, E>) =>
    program.pipe(
      Effect.provide(
        Layer.unwrap(
          Effect.map(logLevelConfig, (level) => Layer.succeed(References.MinimumLogLevel, level)),
        ),
      ),
      Effect.catchCause((cause) =>
        // An interrupt is the process being told to stop, not a failure.
        cause.reasons.every(Cause.isInterruptReason)
          ? Effect.void
          : // Always an error: `logEffectFailure` logs a failure a client caused at debug,
            // and whatever ends the process is not one of those.
            Effect.logError(failure, cause).pipe(
              Effect.annotateLogs(failureAnnotations(Cause.squash(cause))),
              Effect.andThen(
                Effect.sync(() => {
                  process.exitCode = 1;
                }),
              ),
            ),
      ),
      Effect.provide(logger),
    );
