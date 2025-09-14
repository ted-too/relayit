import { createGenericError, type Result } from "@repo/shared/utils";
import { redis } from "bun";

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
