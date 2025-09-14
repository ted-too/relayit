import { createGenericError, type Result } from "@repo/shared/utils";
import { redis } from "bun";
import { eq } from "drizzle-orm";
import { db, schema } from ".";

export const MESSAGE_QUEUE_STREAM = "messageQueue";

// Type-safe Redis stream message structure
export interface QueuedEvent {
  eventId: string;
}

export interface RedisStreamMessage {
  id: string;
  fields: QueuedEvent;
}

/**
 * Adds a message event ID to the Redis message queue stream.
 *
 * @param eventId The unique ID of the message event to queue.
 * @returns A Result object containing the stream entry ID assigned by Redis or an error.
 */
export async function queueMessage(eventId: string): Promise<Result<string>> {
  try {
    const streamEntryId = await redis.send("XADD", [
      MESSAGE_QUEUE_STREAM, // The stream key
      "*", // Generate ID automatically
      "eventId", // Field name
      eventId, // Field value
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
    const errorMessage = `Failed to add event ${eventId} to Redis queue ${MESSAGE_QUEUE_STREAM}`;

    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}

/**
 * Reads events from the Redis stream using XREADGROUP.
 * Returns type-safe event data for worker processing.
 */
export async function readEvents(
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

    for (const [_, streamMessages] of Object.entries(response)) {
      for (const [messageId, fields] of streamMessages) {
        // Parse Redis stream fields into typed structure
        const eventData: Partial<QueuedEvent> = {};

        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const value = fields[i + 1];

          if (key === "eventId" && value) {
            eventData.eventId = value;
          }
        }

        if (eventData.eventId) {
          messages.push({
            id: messageId,
            fields: eventData as QueuedEvent,
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

/**
 * Acknowledges an event in a Redis stream consumer group.
 *
 * @param streamId The ID of the stream entry to acknowledge.
 * @param groupName The name of the consumer group.
 * @returns A Result object containing the number of events acknowledged or an error.
 */
export async function acknowledgeEvent(
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
      const errorMessage = `Redis XACK did not return a number for streamId ${streamId} in group ${groupName}: ${result}`;

      return {
        error: createGenericError(errorMessage),
        data: null,
      };
    }

    return { error: null, data: result };
  } catch (error) {
    const errorMessage = `Failed to acknowledge event streamId ${streamId} in group ${groupName}`;

    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}

/**
 * Claims pending events that have been idle for too long (likely from crashed consumers).
 * Uses XCLAIM to transfer ownership of abandoned events to the current consumer.
 *
 * @param groupName The name of the consumer group.
 * @param consumerName The name of the current consumer claiming the events.
 * @param minIdleTimeMs Minimum idle time in milliseconds before an event can be claimed.
 * @param count Maximum number of events to claim.
 * @returns A Result object containing claimed events or an error.
 */
export async function claimPendingEvents(
  groupName: string,
  consumerName: string,
  minIdleTimeMs: number,
  count = 10
): Promise<Result<[string, string[]][]>> {
  try {
    // First, get pending events to find which ones to claim
    const pendingResult = await getPendingEvents(groupName, count);
    if (pendingResult.error) {
      return {
        error: createGenericError(
          `Failed to get pending events before claiming: ${pendingResult.error.message}`,
          pendingResult.error
        ),
        data: null,
      };
    }

    const { details } = pendingResult.data;

    // Filter events that are idle long enough and get their IDs
    const eventIdsToClaim: string[] = [];

    for (const eventInfo of details) {
      if (Array.isArray(eventInfo) && eventInfo.length >= 4) {
        const [eventId, , idleTime] = eventInfo;
        if (typeof idleTime === "number" && idleTime >= minIdleTimeMs) {
          eventIdsToClaim.push(eventId);
        }
      }
    }

    // If no events to claim, return empty array
    if (eventIdsToClaim.length === 0) {
      return { error: null, data: [] };
    }

    // Claim the events using XCLAIM
    const claimArgs = [
      MESSAGE_QUEUE_STREAM,
      groupName,
      consumerName,
      minIdleTimeMs.toString(),
      ...eventIdsToClaim,
    ];

    const result = await redis.send("XCLAIM", claimArgs);

    // XCLAIM returns an array of [eventId, [field1, value1, field2, value2, ...]]
    if (!Array.isArray(result)) {
      return {
        error: createGenericError("XCLAIM returned unexpected format"),
        data: null,
      };
    }

    return { error: null, data: result as [string, string[]][] };
  } catch (error) {
    const errorMessage = `Failed to claim pending events for group ${groupName}, consumer ${consumerName}`;
    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}

/**
 * Gets information about pending events in a consumer group.
 * Uses XPENDING to check for events that need to be processed or claimed.
 *
 * @param groupName The name of the consumer group.
 * @param count Maximum number of pending event details to return.
 * @returns A Result object containing pending event info or an error.
 */
export async function getPendingEvents(
  groupName: string,
  count = 10
): Promise<Result<any>> {
  try {
    // First get summary: XPENDING stream group
    const summary = await redis.send("XPENDING", [
      MESSAGE_QUEUE_STREAM,
      groupName,
    ]);

    if (!Array.isArray(summary) || summary.length < 4) {
      return { error: null, data: { summary: null, details: [] } };
    }

    const [totalPending, firstId, lastId, consumers] = summary;

    // If there are pending messages, get details
    let details: any[] = [];
    if (totalPending > 0) {
      details = await redis.send("XPENDING", [
        MESSAGE_QUEUE_STREAM,
        groupName,
        firstId,
        lastId,
        count.toString(),
      ]);
    }

    return {
      error: null,
      data: {
        summary: {
          totalPending,
          firstId,
          lastId,
          consumers,
        },
        details,
      },
    };
  } catch (error) {
    const errorMessage = `Failed to get pending events for group ${groupName}`;
    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}

/**
 * Finds message events that are queued in the database but not in Redis.
 * These are events that were created but never queued to Redis, or were lost
 * due to Redis restarts, network issues, or application crashes.
 *
 * @param limit - Maximum number of events to return
 * @param maxAgeMinutes - Only return events newer than this (to avoid processing very old events)
 * @returns Array of message event IDs that need to be queued to Redis
 */
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

    const eventIds = orphanedEvents.map((event) => event.id);

    return { error: null, data: eventIds };
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

/**
 * Checks if a message event is currently being processed by checking if it's
 * in the Redis stream as a pending message. This helps prevent duplicate processing.
 *
 * @param eventId - The message event ID to check
 * @param groupName - The consumer group name
 * @returns True if the event is currently pending in Redis, false otherwise
 */
export async function isEventPendingInRedis(
  eventId: string,
  groupName: string
): Promise<Result<boolean>> {
  try {
    // Get pending messages summary first
    const pendingResult = await getPendingEvents(groupName, 1000);
    if (pendingResult.error) {
      return pendingResult;
    }

    const { details } = pendingResult.data;

    // Check if any pending message contains this eventId
    for (const pendingMessage of details) {
      if (Array.isArray(pendingMessage) && pendingMessage.length >= 4) {
        const [streamId] = pendingMessage;

        // Get the actual message content to check the eventId field
        try {
          const messageContent = await redis.send("XRANGE", [
            MESSAGE_QUEUE_STREAM,
            streamId,
            streamId,
          ]);

          if (Array.isArray(messageContent) && messageContent.length > 0) {
            const [, fields] = messageContent[0];
            if (Array.isArray(fields)) {
              for (let i = 0; i < fields.length; i += 2) {
                if (fields[i] === "eventId" && fields[i + 1] === eventId) {
                  return { error: null, data: true };
                }
              }
            }
          }
        } catch {
          // If we can't read the message, assume it's not our event
        }
      }
    }

    return { error: null, data: false };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to check if event ${eventId} is pending in Redis`,
        error as Error
      ),
      data: null,
    };
  }
}

/**
 * Finds message events that are stuck in "processing" status for too long.
 * These are events where a worker started processing but crashed before completion.
 * 
 * @param timeoutMinutes - Events processing longer than this are considered stuck
 * @param limit - Maximum number of events to return
 * @returns Array of message event IDs that need to be reset and requeued
 */
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
          isNull(table.completedAt) // Make sure it's not completed
        ),
      columns: {
        id: true,
      },
      orderBy: (table, { asc }) => asc(table.startedAt),
      limit,
    });

    const eventIds = stuckEvents.map(event => event.id);
    
    return { error: null, data: eventIds };
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

/**
 * Resets stuck processing events back to queued status and queues them to Redis.
 * This handles events where workers crashed during processing.
 * 
 * @param timeoutMinutes - Events processing longer than this are considered stuck
 * @param limit - Maximum number of events to recover
 * @returns Number of events successfully recovered
 */
export async function recoverStuckProcessingEvents(
  timeoutMinutes = 15,
  limit = 50
): Promise<Result<{ recovered: number; failed: number }>> {
  try {
    // Find stuck events
    const stuckResult = await findStuckProcessingEvents(timeoutMinutes, limit);
    if (stuckResult.error) {
      return stuckResult;
    }

    const stuckEventIds = stuckResult.data;
    if (stuckEventIds.length === 0) {
      return { 
        error: null, 
        data: { recovered: 0, failed: 0 } 
      };
    }

    let recovered = 0;
    let failed = 0;

    // Process each stuck event in a transaction
    for (const eventId of stuckEventIds) {
      try {
        await db.transaction(async (tx) => {
          // Reset the event status back to queued
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

          // Queue it back to Redis
          const queueResult = await queueMessage(eventId);
          if (queueResult.error) {
            throw new Error(`Failed to queue event ${eventId}: ${queueResult.error.message}`);
          }
        });

        recovered++;
      } catch {
        failed++;
        // Continue processing other events even if one fails
      }
    }

    return {
      error: null,
      data: { recovered, failed }
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

/**
 * Recovers orphaned queued events by finding them in the database and queueing them to Redis.
 * Only queues events that are not already pending in Redis to avoid duplicates.
 * 
 * @param groupName - The consumer group name
 * @param limit - Maximum number of events to recover
 * @param maxAgeMinutes - Only recover events newer than this
 * @returns Number of events successfully recovered
 */
export async function recoverOrphanedEvents(
  groupName: string,
  limit = 50,
  maxAgeMinutes = 30
): Promise<Result<{ recovered: number; skipped: number; failed: number }>> {
  try {
    // Find orphaned events
    const orphanedResult = await findOrphanedQueuedEvents(limit, maxAgeMinutes);
    if (orphanedResult.error) {
      return orphanedResult;
    }

    const orphanedEventIds = orphanedResult.data;
    if (orphanedEventIds.length === 0) {
      return {
        error: null,
        data: { recovered: 0, skipped: 0, failed: 0 },
      };
    }

    let recovered = 0;
    let skipped = 0;
    let failed = 0;

    // Process each orphaned event
    for (const eventId of orphanedEventIds) {
      // Check if it's already pending in Redis
      const pendingResult = await isEventPendingInRedis(eventId, groupName);
      if (pendingResult.error) {
        failed++;
        continue;
      }

      if (pendingResult.data) {
        // Already pending in Redis, skip it
        skipped++;
        continue;
      }

      // Queue the event to Redis
      const queueResult = await queueMessage(eventId);
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
