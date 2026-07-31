import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import type { ConsumerOptions } from "./consumer";
import {
  payloadFromFields,
  type StreamConfig,
  type StreamMessage,
} from "./types";

interface PendingSummary {
  consumers: unknown;
  firstId: unknown;
  lastId: unknown;
  totalPending: number;
}

interface PendingEventsData {
  details: Array<string | number>[];
  summary: PendingSummary | null;
}

export function createReclaimer<T>(
  redis: RedisClient,
  config: StreamConfig<T>,
  options: ConsumerOptions
) {
  const { group, consumer } = options;

  async function getPendingEvents(
    count = 10
  ): Promise<Result<PendingEventsData>> {
    try {
      const summary = await redis.send("XPENDING", [config.stream, group]);

      if (!Array.isArray(summary) || summary.length < 4) {
        return { error: null, data: { summary: null, details: [] } };
      }

      const [totalPending, firstId, lastId, consumers] = summary;
      let details: Array<string | number>[] = [];

      if (typeof totalPending === "number" && totalPending > 0) {
        const detailResult = await redis.send("XPENDING", [
          config.stream,
          group,
          String(firstId),
          String(lastId),
          count.toString(),
        ]);

        if (Array.isArray(detailResult)) {
          details = detailResult.filter(
            (detail): detail is Array<string | number> => Array.isArray(detail)
          );
        }
      }

      return {
        error: null,
        data: {
          summary: {
            totalPending: typeof totalPending === "number" ? totalPending : 0,
            firstId,
            lastId,
            consumers,
          },
          details,
        },
      };
    } catch (error) {
      return {
        error: createGenericError(
          `Failed to get pending events for group ${group}`,
          error as Error
        ),
        data: null,
      };
    }
  }

  return {
    pendingSummary: getPendingEvents,

    async claimIdle({
      minIdleMs,
      count = 10,
    }: {
      minIdleMs: number;
      count?: number;
    }): Promise<Result<StreamMessage<T>[]>> {
      try {
        const pendingResult = await getPendingEvents(count);
        if (pendingResult.error) {
          return {
            error: createGenericError(
              `Failed to get pending events before claiming: ${pendingResult.error.message}`,
              pendingResult.error
            ),
            data: null,
          };
        }

        const eventIdsToClaim: string[] = [];

        for (const eventInfo of pendingResult.data.details) {
          if (eventInfo.length < 4) {
            continue;
          }

          const [eventId, , idleTime] = eventInfo;
          if (
            typeof eventId === "string" &&
            typeof idleTime === "number" &&
            idleTime >= minIdleMs
          ) {
            eventIdsToClaim.push(eventId);
          }
        }

        if (eventIdsToClaim.length === 0) {
          return { error: null, data: [] };
        }

        const result = await redis.send("XCLAIM", [
          config.stream,
          group,
          consumer,
          minIdleMs.toString(),
          ...eventIdsToClaim,
        ]);

        if (!Array.isArray(result)) {
          return {
            error: createGenericError("XCLAIM returned unexpected format"),
            data: null,
          };
        }

        const messages: StreamMessage<T>[] = [];
        for (const entry of result) {
          if (!Array.isArray(entry) || entry.length < 2) {
            continue;
          }
          const [messageId, fields] = entry;
          if (typeof messageId !== "string" || !Array.isArray(fields)) {
            continue;
          }
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

        return { error: null, data: messages };
      } catch (error) {
        return {
          error: createGenericError(
            `Failed to claim pending events for group ${group}`,
            error as Error
          ),
          data: null,
        };
      }
    },
  };
}

export type Reclaimer<T> = ReturnType<typeof createReclaimer<T>>;
