import { createGenericError, type Result } from "@repo/shared";
import { redis } from "bun";

export const MESSAGE_QUEUE_STREAM = "messageQueue";

/**
 * Adds a message ID to the Redis message queue stream.
 *
 * @param messageId The unique ID of the message to queue.
 * @returns A Result object containing the stream entry ID assigned by Redis or an error.
 * @throws {HTTPException} If queuing fails.
 */
export async function queueMessage(messageId: string): Promise<Result<string>> {
  try {
    const streamEntryId = await redis.send("XADD", [
      MESSAGE_QUEUE_STREAM, // The stream key
      "*", // Generate ID automatically
      "messageId", // Field name
      messageId, // Field value
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
    const errorMessage = `Failed to add message ${messageId} to Redis queue ${MESSAGE_QUEUE_STREAM}`;

    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}

/**
 * Acknowledges a message in a Redis stream consumer group.
 *
 * @param streamId The ID of the stream entry to acknowledge.
 * @param groupName The name of the consumer group.
 * @returns A Result object containing the number of messages acknowledged or an error.
 * @throws {Error} If acknowledgment fails.
 */
export async function acknowledgeMessage(
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
    const errorMessage = `Failed to acknowledge message streamId ${streamId} in group ${groupName}`;

    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}

/**
 * Claims pending messages that have been idle for too long (likely from crashed consumers).
 * Uses XCLAIM to transfer ownership of abandoned messages to the current consumer.
 *
 * @param groupName The name of the consumer group.
 * @param consumerName The name of the current consumer claiming the messages.
 * @param minIdleTimeMs Minimum idle time in milliseconds before a message can be claimed.
 * @param count Maximum number of messages to claim.
 * @returns A Result object containing claimed messages or an error.
 */
export async function claimPendingMessages(
  groupName: string,
  consumerName: string,
  minIdleTimeMs: number,
  count = 10
): Promise<Result<[string, string[]][]>> {
  try {
    // First, get pending messages to find which ones to claim
    const pendingResult = await getPendingMessages(groupName, count);
    if (pendingResult.error) {
      return {
        error: createGenericError(
          `Failed to get pending messages before claiming: ${pendingResult.error.message}`,
          pendingResult.error
        ),
        data: null,
      };
    }

    const { details } = pendingResult.data;

    // Filter messages that are idle long enough and get their IDs
    const messageIdsToClaim: string[] = [];
    const _now = Date.now();

    for (const messageInfo of details) {
      if (Array.isArray(messageInfo) && messageInfo.length >= 4) {
        const [messageId, , idleTime] = messageInfo;
        // idleTime is in milliseconds
        if (typeof idleTime === "number" && idleTime >= minIdleTimeMs) {
          messageIdsToClaim.push(messageId);
        }
      }
    }

    // If no messages to claim, return empty array
    if (messageIdsToClaim.length === 0) {
      return { error: null, data: [] };
    }

    // Claim the messages using XCLAIM
    const claimArgs = [
      MESSAGE_QUEUE_STREAM,
      groupName,
      consumerName,
      minIdleTimeMs.toString(),
      ...messageIdsToClaim,
    ];

    const result = await redis.send("XCLAIM", claimArgs);

    // XCLAIM returns an array of [messageId, [field1, value1, field2, value2, ...]]
    if (!Array.isArray(result)) {
      return {
        error: createGenericError("XCLAIM returned unexpected format"),
        data: null,
      };
    }

    return { error: null, data: result as [string, string[]][] };
  } catch (error) {
    const errorMessage = `Failed to claim pending messages for group ${groupName}, consumer ${consumerName}`;
    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}

/**
 * Gets information about pending messages in a consumer group.
 * Uses XPENDING to check for messages that need to be processed or claimed.
 *
 * @param groupName The name of the consumer group.
 * @param count Maximum number of pending message details to return.
 * @returns A Result object containing pending message info or an error.
 */
export async function getPendingMessages(
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
    const errorMessage = `Failed to get pending messages for group ${groupName}`;
    return {
      error: createGenericError(errorMessage, error as Error),
      data: null,
    };
  }
}
