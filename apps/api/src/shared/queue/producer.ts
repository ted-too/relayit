import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import { STREAM_PAYLOAD_FIELD, type StreamConfig } from "./types";

export function createProducer<T>(redis: RedisClient, config: StreamConfig<T>) {
  return {
    async enqueue(payload: T): Promise<Result<string>> {
      try {
        const streamEntryId = await redis.send("XADD", [
          config.stream,
          "*",
          STREAM_PAYLOAD_FIELD,
          config.codec.encode(payload),
        ]);

        if (typeof streamEntryId !== "string") {
          return {
            error: createGenericError(
              `Failed to enqueue to ${config.stream}, invalid response from Redis`
            ),
            data: null,
          };
        }

        return { error: null, data: streamEntryId };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to enqueue to stream ${config.stream}`,
            error as Error
          ),
          data: null,
        };
      }
    },
  };
}

export type Producer<T> = ReturnType<typeof createProducer<T>>;
