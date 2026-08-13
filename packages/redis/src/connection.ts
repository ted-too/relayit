import { RedisClient, type RedisOptions } from "bun";
import { Data, Effect } from "effect";

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
  readonly options?: RedisOptions;
  readonly url: string;
}

export interface RedisConnections {
  readonly blocking: RedisClient;
  readonly commands: RedisClient;
}

const redisFailure =
  (operation: RedisOperation) =>
  (cause: unknown): RedisCommandError =>
    new RedisCommandError({ cause, operation });

export const unexpectedResponse = (
  operation: RedisOperation,
  expected: string,
  value: unknown
) =>
  new RedisResponseError({
    expected,
    operation,
    received:
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
  });

export const execute = (
  client: RedisClient,
  operation: RedisOperation,
  command: string,
  args: string[]
) =>
  Effect.tryPromise({
    catch: redisFailure(operation),
    try: (): Promise<unknown> => client.send(command, args),
  });

export const expectNumber = (operation: RedisOperation, value: unknown) =>
  typeof value === "number"
    ? Effect.succeed(value)
    : Effect.fail(unexpectedResponse(operation, "number", value));

export const expectString = (operation: RedisOperation, value: unknown) =>
  typeof value === "string"
    ? Effect.succeed(value)
    : Effect.fail(unexpectedResponse(operation, "string", value));

const acquireConnection = ({ options, url }: RedisLayerConfig) =>
  Effect.acquireRelease(
    Effect.sync(() => new RedisClient(url, options)),
    (client) => Effect.sync(() => client.close())
  );

export const acquireConnections = (config: RedisLayerConfig) =>
  Effect.gen(function* () {
    const commands = yield* acquireConnection(config);
    const blocking = yield* acquireConnection(config);
    return { blocking, commands } satisfies RedisConnections;
  });

export const ping = (client: RedisClient, label = "Redis") =>
  execute(client, "ping", "PING", []).pipe(
    Effect.flatMap((response) =>
      response === "PONG"
        ? Effect.void
        : Effect.fail(
            new RedisResponseError({
              expected: `${label} PONG`,
              operation: "ping",
              received:
                typeof response === "string" ? response : typeof response,
            })
          )
    )
  );
