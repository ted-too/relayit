import type { RedisOptions } from "bun";
import { Data, Effect } from "effect";
import {
  makeRedisClient,
  type RedisClientConfig,
  type RedisCommandClient,
  type RedisReconnectEvent,
} from "./client";

type RedisOperation =
  | "acknowledge"
  | "append"
  | "auto-claim"
  | "create-consumer-group"
  | "evaluate"
  | "ping"
  | "read-group"
  | "sorted-set-add"
  | "sorted-set-remove";

export class RedisCommandError extends Data.TaggedError("RedisCommandError")<{
  readonly cause: unknown;
  readonly operation: RedisOperation;
}> {}

export class RedisResponseError extends Data.TaggedError("RedisResponseError")<{
  readonly expected: string;
  readonly operation: RedisOperation;
  readonly received: string;
}> {}

export type RedisError = RedisCommandError | RedisResponseError;

export interface RedisLayerConfig {
  /**
   * Prepended to every key the `Redis` service sends, Lua `KEYS` included. Empty in
   * production; a worktree sets its own so it never shares jobs or locks with another.
   */
  readonly keyPrefix?: string;
  readonly options?: RedisOptions;
  readonly url: string;
}

export interface RedisConnections {
  readonly blocking: RedisCommandClient;
  readonly commands: RedisCommandClient;
}

/** How a `RedisResponseError` describes a reply it did not expect. */
export const describeReceived = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

export const execute = (
  client: RedisCommandClient,
  operation: RedisOperation,
  command: string,
  args: string[],
) =>
  Effect.tryPromise({
    catch: (cause) => new RedisCommandError({ cause, operation }),
    try: (): Promise<unknown> => client.send(command, args),
  });

export const expectNumber = (operation: RedisOperation, value: unknown) =>
  typeof value === "number"
    ? Effect.succeed(value)
    : Effect.fail(
        new RedisResponseError({
          expected: "number",
          operation,
          received: describeReceived(value),
        }),
      );

export const expectString = (operation: RedisOperation, value: unknown) =>
  typeof value === "string"
    ? Effect.succeed(value)
    : Effect.fail(
        new RedisResponseError({
          expected: "string",
          operation,
          received: describeReceived(value),
        }),
      );

const acquireConnection = (config: RedisClientConfig) =>
  Effect.acquireRelease(
    Effect.sync(() => makeRedisClient(config)),
    (client) => Effect.sync(() => client.close()),
  );

export const acquireConnections = (
  config: RedisLayerConfig,
  onReconnect: (connection: keyof RedisConnections, event: RedisReconnectEvent) => void,
) =>
  Effect.gen(function* () {
    const commands = yield* acquireConnection({
      ...config,
      onReconnect: (event) => onReconnect("commands", event),
    });
    const blocking = yield* acquireConnection({
      ...config,
      onReconnect: (event) => onReconnect("blocking", event),
    });
    return { blocking, commands } satisfies RedisConnections;
  });

export const ping = (client: RedisCommandClient, label = "Redis") =>
  execute(client, "ping", "PING", []).pipe(
    Effect.flatMap((response) =>
      response === "PONG"
        ? Effect.void
        : Effect.fail(
            new RedisResponseError({
              expected: `${label} PONG`,
              operation: "ping",
              received: typeof response === "string" ? response : typeof response,
            }),
          ),
    ),
  );
