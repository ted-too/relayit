import { redis } from "bun";
import { MESSAGE_QUEUE_STREAM, acknowledgeMessage } from "@repo/db";
import { handleMessage } from "@repo/worker/lib/process-message";
import { createGenericError, type Result } from "@repo/shared";
import {
	CONSUMER_GROUP_NAME,
	CONSUMER_NAME,
	BLOCK_TIMEOUT_MS,
	READ_COUNT,
} from "@repo/worker/lib/constants";

let isShuttingDown = false;

/**
 * Initializes the Redis consumer group for the message queue stream.
 * Creates the group if it doesn't exist, starting from the beginning of the stream.
 */
async function initializeConsumerGroup(): Promise<Result<void>> {
	try {
		await redis.send("XGROUP", [
			"CREATE",
			MESSAGE_QUEUE_STREAM,
			CONSUMER_GROUP_NAME,
			"0", // Start from beginning of stream
			"MKSTREAM", // Create stream if doesn't exist
		]);
		console.log(
			`[Worker] Consumer group '${CONSUMER_GROUP_NAME}' ensured on stream '${MESSAGE_QUEUE_STREAM}'.`,
		);
		return { error: null, data: undefined };
	} catch (error: any) {
		if (error?.message?.includes("BUSYGROUP")) {
			console.log(
				`[Worker] Consumer group '${CONSUMER_GROUP_NAME}' already exists on stream '${MESSAGE_QUEUE_STREAM}'. Proceeding.`,
			);
			return { error: null, data: undefined };
		}
		const errMessage = `Failed to create/verify consumer group '${CONSUMER_GROUP_NAME}'`;
		console.error(`[Worker] ${errMessage}:`, error);
		return { error: createGenericError(errMessage, error), data: null };
	}
}

/**
 * The main message processing loop.
 * Continuously attempts to read messages from the stream using XREADGROUP
 * and processes them concurrently using handleMessage.
 */
async function processMessages(): Promise<void> {
	console.log(
		`[Worker] Starting message processing loop for group '${CONSUMER_GROUP_NAME}', consumer '${CONSUMER_NAME}'. Concurrency: ${READ_COUNT}`,
	);
	while (!isShuttingDown) {
		try {
			if (isShuttingDown) break;

			const response = (await redis.send("XREADGROUP", [
				"GROUP",
				CONSUMER_GROUP_NAME,
				CONSUMER_NAME,
				"COUNT",
				READ_COUNT.toString(),
				"BLOCK",
				BLOCK_TIMEOUT_MS.toString(),
				"STREAMS",
				MESSAGE_QUEUE_STREAM,
				">",
			])) as [string, [string, string[]][]][] | null;

			if (isShuttingDown) break;

			if (!response || response.length === 0) {
				continue;
			}

			for (const [_streamName, messages] of response) {
				const processingPromises: Promise<void>[] = [];

				for (const [messageStreamId, fields] of messages) {
					if (isShuttingDown) break;

					let internalMessageId: string | null = null;
					for (let i = 0; i < fields.length; i += 2) {
						if (fields[i] === "messageId") {
							internalMessageId = fields[i + 1]!;
							break;
						}
					}

					if (internalMessageId) {
						console.log(
							`[Worker] Queuing for processing: Stream ID ${messageStreamId}, Internal ID ${internalMessageId}`,
						);
						processingPromises.push(
							handleMessage(
								internalMessageId,
								messageStreamId,
								CONSUMER_GROUP_NAME,
							),
						);
					} else {
						// Malformed message (missing internalMessageId in stream data)
						// Add a promise to acknowledge it directly.
						processingPromises.push(
							(async () => {
								console.warn(
									`[Worker] Stream Message ID ${messageStreamId} lacks 'messageId' field. Acknowledging directly.`,
								);
								const ackRes = await acknowledgeMessage(messageStreamId, CONSUMER_GROUP_NAME);
								if (ackRes.error) {
									console.error(
										`[Worker] CRITICAL: Failed to acknowledge malformed stream message ${messageStreamId}: ${ackRes.error.message}`,
										ackRes.error.details,
									);
								}
							})(),
						);
					}
				} // End of messages in current stream batch

				if (isShuttingDown) break;

				if (processingPromises.length > 0) {
					console.log(
						`[Worker] Processing batch of ${processingPromises.length} message(s) concurrently.`,
					);
					const results = await Promise.allSettled(processingPromises);
					
					let fulfilledCount = 0;
					let rejectedCount = 0;
					results.forEach((result, index) => {
						if (result.status === "fulfilled") {
							fulfilledCount++;
						} else {
							rejectedCount++;
							// Errors from handleMessage or direct ack are already logged internally by those functions.
							// We could log the specific reason for rejection here if needed for a batch summary.
							console.error(`[Worker] Task ${index} in batch rejected:`, result.reason);
						}
					});

					if (rejectedCount > 0) {
						console.warn(
							`[Worker] Batch processing complete. Fulfilled: ${fulfilledCount}, Rejected: ${rejectedCount}. See previous logs for individual errors.`,
						);
					} else {
						console.log(
							`[Worker] Batch of ${fulfilledCount} tasks processed successfully.`,
						);
					}
				}
			} // End of streams in response (typically only one: MESSAGE_QUEUE_STREAM)
		} catch (err: any) {
			if (isShuttingDown) break;
			console.error(
				`[Worker] Error in processMessages outer loop: ${err.message}. Continuing after delay. `,
				{ stack: err.stack },
			);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
	console.log("[Worker] Message processing loop stopped due to shutdown signal.");
}

/**
 * Starts the worker process.
 * Checks Redis connection, initializes consumer group, and starts processing messages.
 */
async function startWorker() {
	console.log("[Worker] Starting worker process...");

	try {
		const pong = await redis.send("PING", []);
		if (pong !== "PONG") {
			console.error(`[Worker] Redis PING failed. Expected PONG, got: ${pong}`);
			process.exit(1);
		}
		console.log("[Worker] Redis PING successful.");
	} catch (error: any) {
		console.error("[Worker] Redis PING failed:", error);
		process.exit(1);
	}

	const groupInitResult = await initializeConsumerGroup();
	if (groupInitResult.error) {
		console.error(
			"[Worker] Failed to initialize consumer group. Exiting.",
			groupInitResult.error,
		);
		process.exit(1);
	}

	process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
	process.on("SIGINT", () => gracefulShutdown("SIGINT"));

	await processMessages();
	console.log(
		"[Worker] ProcessMessages finished. Worker might exit if shutdown was not called via signal.",
	);
}

startWorker().catch((error) => {
	console.error("[Worker] Unhandled error in startWorker. Exiting:", error);
	if (!isShuttingDown) {
		process.exit(1);
	}
});

/** Gracefully shuts down the worker. */
async function gracefulShutdown(signal: string) {
	console.log(`[Worker] Received ${signal}. Starting graceful shutdown...`);
	isShuttingDown = true;

	// Give existing message processing a moment to complete if necessary,
	// but XREADGROUP with BLOCK will mostly handle waiting.
	// The loop will break on the next iteration or when BLOCK times out.
	redis.close();
	console.log("[Worker] Redis connection closed.");

	console.log("[Worker] Shutdown complete. Exiting.");
	process.exit(0);
}
