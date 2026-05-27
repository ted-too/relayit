import { db, schema } from "@repo/api/db";
import { createGenericError, type Result } from "@repo/shared/utils";
import type { RedisClient } from "bun";
import { eq } from "drizzle-orm";

export const MESSAGE_QUEUE_STREAM = "messageQueue";

export type RedisCommandClient = Pick<RedisClient, "send">;

export interface QueuedEvent {
  eventId: string;
}

export interface RedisStreamMessage {
  fields: QueuedEvent;
  id: string;
}

interface PendingEventSummary {
  consumers: unknown;
  firstId: unknown;
  lastId: unknown;
  totalPending: number;
}

type PendingEventDetail = Array<string | number>;

interface PendingEventsData {
  details: PendingEventDetail[];
  summary: PendingEventSummary | null;
}

function parseStreamEvent(fields: string[]): QueuedEvent | null {
  const eventData: Partial<QueuedEvent> = {};

  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];

    if (key === "eventId" && value) {
      eventData.eventId = value;
    }
  }

  return eventData.eventId ? (eventData as QueuedEvent) : null;
}

export async function queueMessage(
  redis: RedisCommandClient,
  eventId: string
): Promise<Result<string>> {
  try {
    const streamEntryId = await redis.send("XADD", [
      MESSAGE_QUEUE_STREAM,
      "*",
      "eventId",
      eventId,
    ]);

    if (typeof streamEntryId !== "string") {
      return {
        error: createGenericError(
          "Failed to queue message, invalid response from Redis."
        ),
        data: null,
      };
    }

    return { error: null, data: streamEntryId };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to add event ${eventId} to Redis queue ${MESSAGE_QUEUE_STREAM}`,
        error as Error
      ),
      data: null,
    };
  }
}

export async function readEvents(
  redis: RedisCommandClient,
  groupName: string,
  consumerName: string,
  count: number,
  blockTimeoutMs: number
): Promise<Result<RedisStreamMessage[]>> {
  try {
    const response = (await redis.send("XREADGROUP", [
      "GROUP",
      groupName,
      consumerName,
      "COUNT",
      count.toString(),
      "BLOCK",
      blockTimeoutMs.toString(),
      "STREAMS",
      MESSAGE_QUEUE_STREAM,
      ">",
    ])) as Record<string, [string, string[]][]> | null;

    if (!response || Object.keys(response).length === 0) {
      return { error: null, data: [] };
    }

    const messages: RedisStreamMessage[] = [];

    for (const streamMessages of Object.values(response)) {
      for (const [messageId, fields] of streamMessages) {
        const eventData = parseStreamEvent(fields);

        if (eventData) {
          messages.push({
            id: messageId,
            fields: eventData,
          });
        }
      }
    }

    return { error: null, data: messages };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to read events from Redis stream ${MESSAGE_QUEUE_STREAM}`,
        error
      ),
      data: null,
    };
  }
}

export async function acknowledgeEvent(
  redis: RedisCommandClient,
  streamId: string,
  groupName: string
): Promise<Result<number>> {
  try {
    const result = await redis.send("XACK", [
      MESSAGE_QUEUE_STREAM,
      groupName,
      streamId,
    ]);

    if (typeof result !== "number") {
      return {
        error: createGenericError(
          `Redis XACK did not return a number for streamId ${streamId} in group ${groupName}: ${result}`
        ),
        data: null,
      };
    }

    return { error: null, data: result };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to acknowledge event streamId ${streamId} in group ${groupName}`,
        error as Error
      ),
      data: null,
    };
  }
}

export async function getPendingEvents(
  redis: RedisCommandClient,
  groupName: string,
  count = 10
): Promise<Result<PendingEventsData>> {
  try {
    const summary = await redis.send("XPENDING", [
      MESSAGE_QUEUE_STREAM,
      groupName,
    ]);

    if (!Array.isArray(summary) || summary.length < 4) {
      return { error: null, data: { summary: null, details: [] } };
    }

    const [totalPending, firstId, lastId, consumers] = summary;
    let details: PendingEventDetail[] = [];

    if (typeof totalPending === "number" && totalPending > 0) {
      const detailResult = await redis.send("XPENDING", [
        MESSAGE_QUEUE_STREAM,
        groupName,
        String(firstId),
        String(lastId),
        count.toString(),
      ]);

      if (Array.isArray(detailResult)) {
        details = detailResult.filter((detail): detail is PendingEventDetail =>
          Array.isArray(detail)
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
        `Failed to get pending events for group ${groupName}`,
        error as Error
      ),
      data: null,
    };
  }
}

export async function claimPendingEvents(
  redis: RedisCommandClient,
  groupName: string,
  consumerName: string,
  minIdleTimeMs: number,
  count = 10
): Promise<Result<[string, string[]][]>> {
  try {
    const pendingResult = await getPendingEvents(redis, groupName, count);
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
        idleTime >= minIdleTimeMs
      ) {
        eventIdsToClaim.push(eventId);
      }
    }

    if (eventIdsToClaim.length === 0) {
      return { error: null, data: [] };
    }

    const result = await redis.send("XCLAIM", [
      MESSAGE_QUEUE_STREAM,
      groupName,
      consumerName,
      minIdleTimeMs.toString(),
      ...eventIdsToClaim,
    ]);

    if (!Array.isArray(result)) {
      return {
        error: createGenericError("XCLAIM returned unexpected format"),
        data: null,
      };
    }

    return { error: null, data: result as [string, string[]][] };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to claim pending events for group ${groupName}, consumer ${consumerName}`,
        error as Error
      ),
      data: null,
    };
  }
}

export async function findOrphanedQueuedEvents(
  limit = 100,
  maxAgeMinutes = 60
): Promise<Result<string[]>> {
  try {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    const orphanedEvents = await db.query.messageEvent.findMany({
      where: (table, { eq, and, gte }) =>
        and(eq(table.status, "queued"), gte(table.startedAt, cutoffTime)),
      columns: {
        id: true,
      },
      orderBy: (table, { asc }) => asc(table.startedAt),
      limit,
    });

    return { error: null, data: orphanedEvents.map((event) => event.id) };
  } catch (error) {
    return {
      error: createGenericError(
        "Failed to find orphaned queued events",
        error as Error
      ),
      data: null,
    };
  }
}

export async function isEventInRedisStream(
  redis: RedisCommandClient,
  eventId: string,
  groupName: string,
  options: {
    fallbackScanLimit?: number;
    maxMessagesInWindow?: number;
    timeWindowHours?: number;
  } = {}
): Promise<Result<boolean>> {
  const {
    timeWindowHours = 1,
    maxMessagesInWindow = 5000,
    fallbackScanLimit = 2000,
  } = options;

  try {
    const pendingResult = await getPendingEvents(redis, groupName, 1000);
    if (pendingResult.error) {
      return pendingResult;
    }

    for (const pendingMessage of pendingResult.data.details) {
      if (pendingMessage.length < 1) {
        continue;
      }

      const [streamId] = pendingMessage;
      if (typeof streamId !== "string") {
        continue;
      }

      try {
        const messageContent = await redis.send("XRANGE", [
          MESSAGE_QUEUE_STREAM,
          streamId,
          streamId,
        ]);

        if (!Array.isArray(messageContent) || messageContent.length === 0) {
          continue;
        }

        const [, fields] = messageContent[0] ?? [];
        if (!Array.isArray(fields)) {
          continue;
        }

        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === "eventId" && fields[i + 1] === eventId) {
            return { error: null, data: true };
          }
        }
      } catch {}
    }

    try {
      const startTime = `${Date.now() - timeWindowHours * 60 * 60 * 1000}-0`;
      const recentMessages = await redis.send("XRANGE", [
        MESSAGE_QUEUE_STREAM,
        startTime,
        "+",
        "COUNT",
        maxMessagesInWindow.toString(),
      ]);

      if (Array.isArray(recentMessages)) {
        for (const message of recentMessages) {
          if (!Array.isArray(message) || message.length < 2) {
            continue;
          }

          const [, fields] = message;
          if (!Array.isArray(fields)) {
            continue;
          }

          for (let i = 0; i < fields.length; i += 2) {
            if (fields[i] === "eventId" && fields[i + 1] === eventId) {
              return { error: null, data: true };
            }
          }
        }
      }
    } catch {
      try {
        const recentMessages = await redis.send("XREVRANGE", [
          MESSAGE_QUEUE_STREAM,
          "+",
          "-",
          "COUNT",
          fallbackScanLimit.toString(),
        ]);

        if (Array.isArray(recentMessages)) {
          for (const message of recentMessages) {
            if (!Array.isArray(message) || message.length < 2) {
              continue;
            }

            const [, fields] = message;
            if (!Array.isArray(fields)) {
              continue;
            }

            for (let i = 0; i < fields.length; i += 2) {
              if (fields[i] === "eventId" && fields[i + 1] === eventId) {
                return { error: null, data: true };
              }
            }
          }
        }
      } catch {
        return { error: null, data: false };
      }
    }

    return { error: null, data: false };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to check if event ${eventId} exists in Redis stream`,
        error as Error
      ),
      data: null,
    };
  }
}

export async function findStuckProcessingEvents(
  timeoutMinutes = 15,
  limit = 100
): Promise<Result<string[]>> {
  try {
    const timeoutTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const stuckEvents = await db.query.messageEvent.findMany({
      where: (table, { eq, and, lt, isNull }) =>
        and(
          eq(table.status, "processing"),
          lt(table.startedAt, timeoutTime),
          isNull(table.completedAt)
        ),
      columns: {
        id: true,
      },
      orderBy: (table, { asc }) => asc(table.startedAt),
      limit,
    });

    return { error: null, data: stuckEvents.map((event) => event.id) };
  } catch (error) {
    return {
      error: createGenericError(
        "Failed to find stuck processing events",
        error as Error
      ),
      data: null,
    };
  }
}

export async function recoverStuckProcessingEvents(
  redis: RedisCommandClient,
  timeoutMinutes = 15,
  limit = 50
): Promise<Result<{ failed: number; recovered: number }>> {
  try {
    const stuckResult = await findStuckProcessingEvents(timeoutMinutes, limit);
    if (stuckResult.error) {
      return stuckResult;
    }

    if (stuckResult.data.length === 0) {
      return {
        error: null,
        data: { recovered: 0, failed: 0 },
      };
    }

    let recovered = 0;
    let failed = 0;

    for (const eventId of stuckResult.data) {
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.messageEvent)
            .set({
              status: "queued",
              completedAt: null,
              responseTimeMs: null,
              error: null,
              retryable: null,
            })
            .where(eq(schema.messageEvent.id, eventId));

          const queueResult = await queueMessage(redis, eventId);
          if (queueResult.error) {
            throw new Error(
              `Failed to queue event ${eventId}: ${queueResult.error.message}`
            );
          }
        });

        recovered++;
      } catch {
        failed++;
      }
    }

    return {
      error: null,
      data: { recovered, failed },
    };
  } catch (error) {
    return {
      error: createGenericError(
        "Failed to recover stuck processing events",
        error as Error
      ),
      data: null,
    };
  }
}

export async function recoverOrphanedEvents(
  redis: RedisCommandClient,
  groupName: string,
  limit = 50,
  maxAgeMinutes = 30,
  streamScanOptions?: {
    fallbackScanLimit?: number;
    maxMessagesInWindow?: number;
    timeWindowHours?: number;
  }
): Promise<Result<{ failed: number; recovered: number; skipped: number }>> {
  try {
    const orphanedResult = await findOrphanedQueuedEvents(limit, maxAgeMinutes);
    if (orphanedResult.error) {
      return orphanedResult;
    }

    if (orphanedResult.data.length === 0) {
      return {
        error: null,
        data: { recovered: 0, skipped: 0, failed: 0 },
      };
    }

    let recovered = 0;
    let skipped = 0;
    let failed = 0;

    for (const eventId of orphanedResult.data) {
      const inStreamResult = await isEventInRedisStream(
        redis,
        eventId,
        groupName,
        streamScanOptions
      );
      if (inStreamResult.error) {
        failed++;
        continue;
      }

      if (inStreamResult.data) {
        skipped++;
        continue;
      }

      const queueResult = await queueMessage(redis, eventId);
      if (queueResult.error) {
        failed++;
        continue;
      }

      recovered++;
    }

    return {
      error: null,
      data: { recovered, skipped, failed },
    };
  } catch (error) {
    return {
      error: createGenericError(
        "Failed to recover orphaned events",
        error as Error
      ),
      data: null,
    };
  }
}
