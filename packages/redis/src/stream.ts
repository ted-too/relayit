import { Effect } from "effect";
import {
  execute,
  expectNumber,
  expectString,
  type RedisConnections,
  unexpectedResponse,
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
  if (
    Array.isArray(value) &&
    typeof value[0] === "string" &&
    Array.isArray(value[1])
  ) {
    const entries = streamEntries(value[1]);
    if (entries) {
      return Effect.succeed({
        entries,
        nextStart: value[0],
      } satisfies AutoClaimResult);
    }
  }

  return Effect.fail(
    unexpectedResponse("auto-claim", "[next cursor, stream entries]", value)
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
          unexpectedResponse("read-group", "stream entry collection", value)
        );
      }
      entries.push(...parsed.map((entry) => ({ ...entry, stream })));
    }
    return Effect.succeed(entries);
  }

  if (!Array.isArray(value)) {
    return Effect.fail(
      unexpectedResponse("read-group", "stream read response", value)
    );
  }

  const entries: StreamReadEntry[] = [];
  for (const stream of value) {
    if (
      !(
        Array.isArray(stream) &&
        typeof stream[0] === "string" &&
        Array.isArray(stream[1])
      )
    ) {
      return Effect.fail(
        unexpectedResponse("read-group", "stream read response", value)
      );
    }
    const parsed = streamEntries(stream[1]);
    if (!parsed) {
      return Effect.fail(
        unexpectedResponse("read-group", "stream entry collection", value)
      );
    }
    entries.push(...parsed.map((entry) => ({ ...entry, stream: stream[0] })));
  }
  return Effect.succeed(entries);
};

export const makeStreamCommands = ({
  blocking,
  commands,
}: RedisConnections): StreamCommands => ({
  acknowledge: ({ group, id, stream }) =>
    execute(commands, "acknowledge", "XACK", [stream, group, id]).pipe(
      Effect.flatMap((value) => expectNumber("acknowledge", value))
    ),
  append: ({ fields, stream }) =>
    execute(commands, "append", "XADD", [
      stream,
      "*",
      ...Object.entries(fields).flat(),
    ]).pipe(Effect.flatMap((value) => expectString("append", value))),
  autoClaim: ({ consumer, count, group, minIdleMs, start, stream }) =>
    execute(commands, "auto-claim", "XAUTOCLAIM", [
      stream,
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
      stream,
      group,
      "0",
      "MKSTREAM",
    ]).pipe(
      Effect.asVoid,
      Effect.catchTag("RedisCommandError", (error) =>
        error.cause instanceof Error &&
        error.cause.message.includes("BUSYGROUP")
          ? Effect.void
          : Effect.fail(error)
      )
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
      ...streams,
      ...streams.map(() => ">"),
    ]).pipe(Effect.flatMap(decodeReadGroupEntries)),
});
