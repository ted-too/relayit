import { Context, Effect, Layer } from "effect";
import {
  acquireConnections,
  execute,
  expectNumber,
  expectString,
  ping,
  type RedisError,
  type RedisLayerConfig,
} from "./connection";
import {
  type AppendInput,
  type AutoClaimInput,
  type AutoClaimResult,
  type ConsumerInput,
  makeStreamCommands,
  type ReadGroupInput,
  type StreamEntry,
  type StreamReadEntry,
} from "./stream";

interface EvaluateNumberInput {
  readonly args: readonly string[];
  readonly keys: readonly string[];
  readonly script: string;
}

type EvaluateStringInput = EvaluateNumberInput;

export interface RedisService {
  readonly acknowledge: (
    input: Omit<ConsumerInput, "consumer"> & { readonly id: string }
  ) => Effect.Effect<number, RedisError>;
  readonly append: (
    input: AppendInput
  ) => Effect.Effect<StreamEntry["id"], RedisError>;
  readonly autoClaim: (
    input: AutoClaimInput
  ) => Effect.Effect<AutoClaimResult, RedisError>;
  readonly createConsumerGroup: (
    input: Omit<ConsumerInput, "consumer">
  ) => Effect.Effect<void, RedisError>;
  readonly evaluateNumber: (
    input: EvaluateNumberInput
  ) => Effect.Effect<number, RedisError>;
  readonly evaluateString: (
    input: EvaluateStringInput
  ) => Effect.Effect<string, RedisError>;
  readonly ping: Effect.Effect<void, RedisError>;
  readonly readGroup: (
    input: ReadGroupInput
  ) => Effect.Effect<readonly StreamReadEntry[], RedisError>;
  readonly sortedSetAdd: (input: {
    readonly key: string;
    readonly member: string;
    readonly score: number;
  }) => Effect.Effect<number, RedisError>;
  readonly sortedSetRemove: (input: {
    readonly key: string;
    readonly member: string;
  }) => Effect.Effect<number, RedisError>;
}

export class Redis extends Context.Service<Redis, RedisService>()(
  "Redis/Commands"
) {}

export const makeRedisLive = (config: RedisLayerConfig) =>
  Layer.effect(
    Redis,
    Effect.gen(function* () {
      const connections = yield* acquireConnections(config);
      const healthcheck = ping(connections.commands);

      yield* healthcheck;
      yield* ping(connections.blocking, "Blocking Redis");

      return {
        ...makeStreamCommands(connections),
        evaluateNumber: ({ args, keys, script }) =>
          execute(connections.commands, "evaluate", "EVAL", [
            script,
            String(keys.length),
            ...keys,
            ...args,
          ]).pipe(Effect.flatMap((value) => expectNumber("evaluate", value))),
        evaluateString: ({ args, keys, script }) =>
          execute(connections.commands, "evaluate", "EVAL", [
            script,
            String(keys.length),
            ...keys,
            ...args,
          ]).pipe(Effect.flatMap((value) => expectString("evaluate", value))),
        ping: healthcheck,
        sortedSetAdd: ({ key, member, score }) =>
          execute(connections.commands, "sorted-set-add", "ZADD", [
            key,
            String(score),
            member,
          ]).pipe(
            Effect.flatMap((value) => expectNumber("sorted-set-add", value))
          ),
        sortedSetRemove: ({ key, member }) =>
          execute(connections.commands, "sorted-set-remove", "ZREM", [
            key,
            member,
          ]).pipe(
            Effect.flatMap((value) => expectNumber("sorted-set-remove", value))
          ),
      } satisfies RedisService;
    })
  );
