import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import {
  payloadFromFields,
  type StreamConfig,
  type StreamMessage,
} from "./types";

export interface ConsumerOptions {
  consumer: string;
  group: string;
}

export function createConsumer<T>(
  redis: RedisClient,
  config: StreamConfig<T>,
  options: ConsumerOptions
) {
  const { group, consumer } = options;

  return {
    async ensureGroup(): Promise<Result<void>> {
      try {
        await redis.send("XGROUP", [
          "CREATE",
          config.stream,
          group,
          "0",
          "MKSTREAM",
        ]);
        return { error: null, data: undefined };
      } catch (error) {
        const message = (error as Error).message ?? "";
        if (message.includes("BUSYGROUP")) {
          return { error: null, data: undefined };
        }
        return {
          error: createGenericError(
            `Failed to create consumer group ${group} on ${config.stream}`,
            error as Error
          ),
          data: null,
        };
      }
    },

    async read({
      count,
      blockMs,
    }: {
      count: number;
      blockMs: number;
    }): Promise<Result<StreamMessage<T>[]>> {
      try {
        const response = (await redis.send("XREADGROUP", [
          "GROUP",
          group,
          consumer,
          "COUNT",
          count.toString(),
          "BLOCK",
          blockMs.toString(),
          "STREAMS",
          config.stream,
          ">",
        ])) as Record<string, [string, string[]][]> | null;

        if (!response || Object.keys(response).length === 0) {
          return { error: null, data: [] };
        }

        const messages: StreamMessage<T>[] = [];

        for (const streamMessages of Object.values(response)) {
          for (const [messageId, fields] of streamMessages) {
            const raw = payloadFromFields(fields);
            if (!raw) {
              continue;
            }
            const result = config.codec.safeDecode(raw);
            if (!result.success) {
              continue;
            }
            messages.push({ id: messageId, payload: result.data });
          }
        }

        return { error: null, data: messages };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to read from stream ${config.stream}`,
            error as Error
          ),
          data: null,
        };
      }
    },

    async deleteConsumer(): Promise<Result<number>> {
      try {
        const removedPending = await redis.send("XGROUP", [
          "DELCONSUMER",
          config.stream,
          group,
          consumer,
        ]);

        return {
          error: null,
          data: typeof removedPending === "number" ? removedPending : 0,
        };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to delete consumer ${consumer} on ${config.stream}`,
            error as Error
          ),
          data: null,
        };
      }
    },

    async pruneIdleConsumers({
      minIdleMs,
    }: {
      minIdleMs: number;
    }): Promise<Result<string[]>> {
      try {
        const infos = await redis.send("XINFO", [
          "CONSUMERS",
          config.stream,
          group,
        ]);

        if (!Array.isArray(infos)) {
          return { error: null, data: [] };
        }

        const pruned: string[] = [];

        for (const info of infos) {
          // Bun maps XINFO replies to objects, but tolerate flat [k, v, …] too.
          const record: Record<string, unknown> = Array.isArray(info)
            ? Object.fromEntries(
                info.flatMap((value, index, all) =>
                  index % 2 === 0 ? [[String(value), all[index + 1]]] : []
                )
              )
            : (info as Record<string, unknown>);

          const name =
            typeof record.name === "string" ? record.name : undefined;
          const pending = Number(record.pending ?? 0);
          const idle = Number(record.idle ?? 0);

          // Never prune ourselves; only remove drained consumers that have sat
          // idle past the threshold (orphans left by crashed workers).
          if (!name || name === consumer) {
            continue;
          }
          if (pending === 0 && idle >= minIdleMs) {
            await redis.send("XGROUP", [
              "DELCONSUMER",
              config.stream,
              group,
              name,
            ]);
            pruned.push(name);
          }
        }

        return { error: null, data: pruned };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to prune idle consumers on ${config.stream}`,
            error as Error
          ),
          data: null,
        };
      }
    },

    async ack(streamId: string): Promise<Result<number>> {
      try {
        const result = await redis.send("XACK", [
          config.stream,
          group,
          streamId,
        ]);

        if (typeof result !== "number") {
          return {
            error: createGenericError(
              `Redis XACK did not return a number for streamId ${streamId}`
            ),
            data: null,
          };
        }

        return { error: null, data: result };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to acknowledge ${streamId} on ${config.stream}`,
            error as Error
          ),
          data: null,
        };
      }
    },
  };
}

export type Consumer<T> = ReturnType<typeof createConsumer<T>>;
