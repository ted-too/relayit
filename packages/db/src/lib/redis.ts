import { type Result, createGenericError } from "@repo/shared";
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
					"Failed to queue message, invalid response from Redis.",
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
	groupName: string,
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
