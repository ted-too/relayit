import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import { STREAM_PAYLOAD_FIELD, type StreamConfig } from "./types";

const PROMOTE_DUE_SCRIPT = `
local scheduleKey = KEYS[1]
local streamKey = KEYS[2]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local members = redis.call('ZRANGEBYSCORE', scheduleKey, '-inf', now, 'LIMIT', 0, limit)
local promoted = 0
for _, member in ipairs(members) do
  redis.call('XADD', streamKey, '*', '${STREAM_PAYLOAD_FIELD}', member)
  redis.call('ZREM', scheduleKey, member)
  promoted = promoted + 1
end
return promoted
`;

function toDueAtMs(dueAt: Date | number): number {
  return dueAt instanceof Date ? dueAt.getTime() : dueAt;
}

export function createScheduler<T>(
  redis: RedisClient,
  config: StreamConfig<T> & { scheduleKey: string }
) {
  const { scheduleKey } = config;

  return {
    async schedule(payload: T, dueAt: Date | number): Promise<Result<number>> {
      try {
        const member = config.codec.encode(payload);
        const result = await redis.send("ZADD", [
          scheduleKey,
          toDueAtMs(dueAt).toString(),
          member,
        ]);

        if (typeof result !== "number") {
          return {
            error: createGenericError("ZADD returned unexpected format"),
            data: null,
          };
        }

        return { error: null, data: result };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to schedule member on ${scheduleKey}`,
            error as Error
          ),
          data: null,
        };
      }
    },

    async unschedule(payload: T): Promise<Result<number>> {
      try {
        const member = config.codec.encode(payload);
        const result = await redis.send("ZREM", [scheduleKey, member]);

        if (typeof result !== "number") {
          return {
            error: createGenericError("ZREM returned unexpected format"),
            data: null,
          };
        }

        return { error: null, data: result };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to unschedule member on ${scheduleKey}`,
            error as Error
          ),
          data: null,
        };
      }
    },

    async promoteDue({
      now,
      limit,
    }: {
      now: number;
      limit: number;
    }): Promise<Result<number>> {
      try {
        const promoted = await redis.send("EVAL", [
          PROMOTE_DUE_SCRIPT,
          "2",
          scheduleKey,
          config.stream,
          now.toString(),
          limit.toString(),
        ]);

        if (typeof promoted !== "number") {
          return {
            error: createGenericError(
              "Promote script returned unexpected format"
            ),
            data: null,
          };
        }

        return { error: null, data: promoted };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to promote due members on ${scheduleKey}`,
            error as Error
          ),
          data: null,
        };
      }
    },
  };
}

export type Scheduler<T> = ReturnType<typeof createScheduler<T>>;
