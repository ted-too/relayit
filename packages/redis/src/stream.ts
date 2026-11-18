import { Effect } from "effect";
import {
  describeReceived,
  execute,
  expectNumber,
  expectString,
  type RedisConnections,
  RedisResponseError,
} from "./connection";
import type { RedisService } from "./redis";

export interface StreamEntry {
  readonly fields: readonly string[];
  readonly id: string;
}

export interface StreamReadEntry extends StreamEntry {
  readonly stream: string;
}

export interface AutoClaimResult {
  readonly entries: readonly StreamEntry[];
  readonly nextStart: string;
}

export interface AppendInput {
  readonly fields: Readonly<Record<string, string>>;
  readonly stream: string;
}

export interface ReadGroupInput {
  readonly blockMs: number;
  readonly consumer: string;
  readonly count: number;
  readonly group: string;
  readonly streams: readonly string[];
}

export interface ConsumerInput {
  readonly consumer: string;
  readonly group: string;
  readonly stream: string;
}

export interface AutoClaimInput extends ConsumerInput {
  readonly count: number;
  readonly minIdleMs: number;
  readonly start: string;
}

type StreamCommands = Pick<
  RedisService,
  "acknowledge" | "append" | "autoClaim" | "createConsumerGroup" | "readGroup"
>;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const streamEntry = (value: unknown): StreamEntry | null => {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const [id, fields] = value;
  return typeof id === "string" &&
    Array.isArray(fields) &&
    fields.every((item) => typeof item === "string")
    ? { fields, id }
    : null;
};

const streamEntries = (value: unknown): readonly StreamEntry[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries: StreamEntry[] = [];
  for (const valueEntry of value) {
    const parsed = streamEntry(valueEntry);
    if (!parsed) {
      return null;
    }
    entries.push(parsed);
  }
  return entries;
};

export const decodeAutoClaimResult = (value: unknown) => {
  if (Array.isArray(value) && typeof value[0] === "string" && Array.isArray(value[1])) {
    const entries = streamEntries(value[1]);
    if (entries) {
      return Effect.succeed({
        entries,
        nextStart: value[0],
      } satisfies AutoClaimResult);
    }
  }

  return Effect.fail(
    new RedisResponseError({
      expected: "[next cursor, stream entries]",
      operation: "auto-claim",
      received: describeReceived(value),
    }),
  );
};

export const decodeReadGroupEntries = (value: unknown) => {
  if (value === null) {
    return Effect.succeed<readonly StreamReadEntry[]>([]);
  }

  const record = asRecord(value);
  if (record) {
    const entries: StreamReadEntry[] = [];
    for (const [stream, rawEntries] of Object.entries(record)) {
      const parsed = streamEntries(rawEntries);
      if (!parsed) {
        return Effect.fail(
          new RedisResponseError({
            expected: "stream entry collection",
            operation: "read-group",
            received: describeReceived(value),
          }),
        );
      }
      entries.push(...parsed.map((entry) => ({ ...entry, stream })));
    }
    return Effect.succeed(entries);
  }

  if (!Array.isArray(value)) {
    return Effect.fail(
      new RedisResponseError({
        expected: "stream read response",
        operation: "read-group",
        received: describeReceived(value),
      }),
    );
  }

  const entries: StreamReadEntry[] = [];
  for (const stream of value) {
    if (!(Array.isArray(stream) && typeof stream[0] === "string" && Array.isArray(stream[1]))) {
      return Effect.fail(
        new RedisResponseError({
          expected: "stream read response",
          operation: "read-group",
          received: describeReceived(value),
        }),
      );
    }
    const parsed = streamEntries(stream[1]);
    if (!parsed) {
      return Effect.fail(
        new RedisResponseError({
          expected: "stream entry collection",
          operation: "read-group",
          received: describeReceived(value),
        }),
      );
    }
    entries.push(...parsed.map((entry) => ({ ...entry, stream: stream[0] })));
  }
  return Effect.succeed(entries);
};

/**
 * `keyPrefix` namespaces every stream this service touches, so checkouts sharing one Redis
 * never read each other's jobs. Stream names in replies come back without it.
 */
export const makeStreamCommands = (
  { blocking, commands }: RedisConnections,
  keyPrefix: string,
): StreamCommands => ({
  acknowledge: ({ group, id, stream }) =>
    execute(commands, "acknowledge", "XACK", [keyPrefix + stream, group, id]).pipe(
      Effect.flatMap((value) => expectNumber("acknowledge", value)),
    ),
  append: ({ fields, stream }) =>
    execute(commands, "append", "XADD", [
      keyPrefix + stream,
      "*",
      ...Object.entries(fields).flat(),
    ]).pipe(Effect.flatMap((value) => expectString("append", value))),
  autoClaim: ({ consumer, count, group, minIdleMs, start, stream }) =>
    execute(commands, "auto-claim", "XAUTOCLAIM", [
      keyPrefix + stream,
      group,
      consumer,
      String(minIdleMs),
      start,
      "COUNT",
      String(count),
    ]).pipe(Effect.flatMap(decodeAutoClaimResult)),
  createConsumerGroup: ({ group, stream }) =>
    execute(commands, "create-consumer-group", "XGROUP", [
      "CREATE",
      keyPrefix + stream,
      group,
      "0",
      "MKSTREAM",
    ]).pipe(
      Effect.asVoid,
      Effect.catchTags({
        RedisCommandError: (error) =>
          error.cause instanceof Error && error.cause.message.includes("BUSYGROUP")
            ? Effect.void
            : Effect.fail(error),
      }),
    ),
  readGroup: ({ blockMs, consumer, count, group, streams }) =>
    execute(blocking, "read-group", "XREADGROUP", [
      "GROUP",
      group,
      consumer,
      "COUNT",
      String(count),
      "BLOCK",
      String(blockMs),
      "STREAMS",
      ...streams.map((stream) => keyPrefix + stream),
      ...streams.map(() => ">"),
    ]).pipe(
      Effect.flatMap(decodeReadGroupEntries),
      Effect.map((entries) =>
        entries.map((entry) => ({ ...entry, stream: entry.stream.slice(keyPrefix.length) })),
      ),
    ),
});
