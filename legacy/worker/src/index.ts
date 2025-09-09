import {
	acknowledgeMessage,
	claimPendingMessages,
	getPendingMessages,
	MESSAGE_QUEUE_STREAM,
} from "@repo/db";
import { createGenericError, type Result } from "@repo/shared";
import {
	BLOCK_TIMEOUT_MS,
	CONSUMER_GROUP_NAME,
	CONSUMER_NAME,
	MAX_CLAIM_COUNT,
	MIN_IDLE_TIME_MS,
	PENDING_CHECK_INTERVAL_MS,
	READ_COUNT,
} from "@repo/worker/lib/constants";
import { handleMessage } from "@repo/worker/lib/process-message";
import { logger } from "@repo/worker/lib/utils";
import { redis } from "bun";

let isShuttingDown = false;
let pendingRecoveryInterval: NodeJS.Timeout | null = null;

// Global context for worker operations
const workerContext: Record<string, any> = {
	workerId: CONSUMER_NAME,
	consumerGroup: CONSUMER_GROUP_NAME,
	stream: MESSAGE_QUEUE_STREAM,
	concurrency: READ_COUNT,
	blockTimeout: BLOCK_TIMEOUT_MS,
};

/**
 * Initializes the Redis consumer group for the message queue stream.
 * Creates the group if it doesn't exist, starting from the beginning of the stream.
 */
async function initializeConsumerGroup(): Promise<Result<void>> {
	const startTime = Date.now();

	logger.debug(
		{ ...workerContext, operation: "initializeConsumerGroup" },
		"Initializing Redis consumer group"
	);

	try {
		await redis.send("XGROUP", [
			"CREATE",
			MESSAGE_QUEUE_STREAM,
			CONSUMER_GROUP_NAME,
			"0", // Start from beginning of stream
			"MKSTREAM", // Create stream if doesn't exist
		]);

		const duration = Date.now() - startTime;
		logger.info(
			{
				...workerContext,
				operation: "initializeConsumerGroup",
				duration,
				created: true,
			},
			`Consumer group '${CONSUMER_GROUP_NAME}' created successfully`
		);
		return { error: null, data: undefined };
	} catch (error: any) {
		const duration = Date.now() - startTime;

		if (error?.message?.includes("BUSYGROUP")) {
			logger.info(
				{
					...workerContext,
					operation: "initializeConsumerGroup",
					duration,
					created: false,
					alreadyExists: true,
				},
				`Consumer group '${CONSUMER_GROUP_NAME}' already exists. Proceeding.`
			);
			return { error: null, data: undefined };
		}

		const errMessage = `Failed to create/verify consumer group '${CONSUMER_GROUP_NAME}'`;
		logger.error(
			{
				...workerContext,
				error,
				operation: "initializeConsumerGroup",
				duration,
			},
			errMessage
		);
		return { error: createGenericError(errMessage, error), data: null };
	}
}

/**
 * Checks for and claims pending messages that may have been abandoned by crashed workers.
 * This ensures message processing reliability across worker restarts.
 */
async function checkAndClaimPendingMessages(): Promise<void> {
	const startTime = Date.now();

	logger.debug(
		{
			...workerContext,
			operation: "checkAndClaimPendingMessages",
			minIdleTimeMs: MIN_IDLE_TIME_MS,
			maxClaimCount: MAX_CLAIM_COUNT,
		},
		"Checking for pending messages to claim"
	);

	try {
		// First, get pending message summary for visibility
		const pendingResult = await getPendingMessages(CONSUMER_GROUP_NAME, 10);
		if (pendingResult.error) {
			logger.error(
				{
					...workerContext,
					operation: "checkAndClaimPendingMessages",
					stage: "get_pending_info",
					error: pendingResult.error,
				},
				"Failed to get pending message info"
			);
			return;
		}

		const { summary, details } = pendingResult.data;

		if (summary?.totalPending > 0) {
			logger.info(
				{
					...workerContext,
					operation: "checkAndClaimPendingMessages",
					stage: "pending_summary",
					totalPending: summary.totalPending,
					consumers: summary.consumers,
					firstId: summary.firstId,
					lastId: summary.lastId,
				},
				`Found ${summary.totalPending} pending messages in consumer group`
			);
		}

		// Attempt to claim abandoned messages
		const claimResult = await claimPendingMessages(
			CONSUMER_GROUP_NAME,
			CONSUMER_NAME,
			MIN_IDLE_TIME_MS,
			MAX_CLAIM_COUNT
		);

		const duration = Date.now() - startTime;

		if (claimResult.error) {
			logger.error(
				{
					...workerContext,
					operation: "checkAndClaimPendingMessages",
					stage: "claim_messages",
					error: claimResult.error,
					duration,
				},
				"Failed to claim pending messages"
			);
			return;
		}

		const claimedMessages = claimResult.data;

		if (claimedMessages.length > 0) {
			logger.info(
				{
					...workerContext,
					operation: "checkAndClaimPendingMessages",
					stage: "messages_claimed",
					claimedCount: claimedMessages.length,
					duration,
				},
				`Successfully claimed ${claimedMessages.length} abandoned messages`
			);

			// Process the claimed messages
			const processingPromises: Promise<void>[] = [];

			for (const [messageStreamId, fields] of claimedMessages) {
				let internalMessageId: string | null = null;
				for (let i = 0; i < fields.length; i += 2) {
					if (fields[i] === "messageId") {
						internalMessageId = fields[i + 1]!;
						break;
					}
				}

				if (internalMessageId) {
					logger.debug(
						{
							...workerContext,
							operation: "checkAndClaimPendingMessages",
							stage: "process_claimed",
							messageStreamId,
							internalMessageId,
						},
						"Processing claimed message"
					);

					processingPromises.push(
						handleMessage(
							internalMessageId,
							messageStreamId,
							CONSUMER_GROUP_NAME
						)
					);
				} else {
					logger.warn(
						{
							...workerContext,
							operation: "checkAndClaimPendingMessages",
							stage: "malformed_claimed",
							messageStreamId,
						},
						"Claimed message lacks messageId field. Acknowledging directly."
					);

					// Acknowledge malformed claimed message
					processingPromises.push(
						(async () => {
							const ackRes = await acknowledgeMessage(
								messageStreamId,
								CONSUMER_GROUP_NAME
							);
							if (ackRes.error) {
								logger.error(
									{
										...workerContext,
										error: ackRes.error,
										messageStreamId,
										stage: "claimed_malformed_ack_failed",
									},
									"Failed to acknowledge malformed claimed message"
								);
							}
						})()
					);
				}
			}

			// Process all claimed messages concurrently
			if (processingPromises.length > 0) {
				const results = await Promise.allSettled(processingPromises);
				let successCount = 0;
				let failureCount = 0;

				for (const result of results) {
					if (result.status === "fulfilled") {
						successCount++;
					} else {
						failureCount++;
					}
				}

				logger.info(
					{
						...workerContext,
						operation: "checkAndClaimPendingMessages",
						stage: "claimed_processing_complete",
						totalClaimed: claimedMessages.length,
						successCount,
						failureCount,
						totalDuration: Date.now() - startTime,
					},
					`Completed processing ${claimedMessages.length} claimed messages`
				);
			}
		} else {
			logger.debug(
				{
					...workerContext,
					operation: "checkAndClaimPendingMessages",
					stage: "no_messages_claimed",
					duration,
				},
				"No pending messages found to claim"
			);
		}
	} catch (error: any) {
		const duration = Date.now() - startTime;
		logger.error(
			{
				...workerContext,
				operation: "checkAndClaimPendingMessages",
				stage: "unhandled_error",
				error,
				stack: error.stack,
				duration,
			},
			`Unhandled error in pending message check: ${error.message}`
		);
	}
}

/**
 * Starts the pending message recovery loop that runs in the background.
 * This periodically checks for and claims abandoned messages.
 */
function startPendingMessageRecovery(): NodeJS.Timeout {
	logger.info(
		{
			...workerContext,
			operation: "startPendingMessageRecovery",
			intervalMs: PENDING_CHECK_INTERVAL_MS,
			minIdleTimeMs: MIN_IDLE_TIME_MS,
		},
		"Starting pending message recovery loop"
	);

	return setInterval(async () => {
		if (!isShuttingDown) {
			await checkAndClaimPendingMessages();
		}
	}, PENDING_CHECK_INTERVAL_MS);
}

/**
 * The main message processing loop.
 * Continuously attempts to read messages from the stream using XREADGROUP
 * and processes them concurrently using handleMessage.
 */
async function processMessages(): Promise<void> {
	const startTime = Date.now();
	let totalMessagesProcessed = 0;
	let totalBatchesProcessed = 0;

	logger.info(
		{
			...workerContext,
			operation: "processMessages",
			startTime,
		},
		"Starting message processing loop"
	);

	while (!isShuttingDown) {
		try {
			if (isShuttingDown) {
				break;
			}

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
			])) as Record<string, [string, string[]][]> | null;

			if (isShuttingDown) {
				break;
			}

			if (!response || Object.keys(response).length === 0) {
				continue;
			}

			for (const [streamName, messages] of Object.entries(response)) {
				const batchStartTime = Date.now();
				const processingPromises: Promise<void>[] = [];
				const batchContext = {
					...workerContext,
					operation: "processBatch",
					streamName,
					batchSize: messages.length,
					batchId: `batch_${Date.now()}`,
				};

				logger.debug(
					batchContext,
					`Processing batch of ${messages.length} messages`
				);

				for (const [messageStreamId, fields] of messages) {
					if (isShuttingDown) {
						break;
					}

					let internalMessageId: string | null = null;
					for (let i = 0; i < fields.length; i += 2) {
						if (fields[i] === "messageId") {
							internalMessageId = fields[i + 1]!;
							break;
						}
					}

					if (internalMessageId) {
						logger.debug(
							{
								...batchContext,
								messageStreamId,
								internalMessageId,
								stage: "queue_message",
							},
							"Queuing message for processing"
						);
						processingPromises.push(
							handleMessage(
								internalMessageId,
								messageStreamId,
								CONSUMER_GROUP_NAME
							)
						);
					} else {
						// Malformed message (missing internalMessageId in stream data)
						// Add a promise to acknowledge it directly.
						processingPromises.push(
							(async () => {
								logger.warn(
									{
										...batchContext,
										messageStreamId,
										stage: "malformed_message",
									},
									"Stream message lacks messageId field. Acknowledging directly."
								);
								const ackRes = await acknowledgeMessage(
									messageStreamId,
									CONSUMER_GROUP_NAME
								);
								if (ackRes.error) {
									logger.error(
										{
											...batchContext,
											error: ackRes.error,
											details: ackRes.error.details,
											messageStreamId,
											stage: "malformed_ack_failed",
										},
										`CRITICAL: Failed to acknowledge malformed stream message: ${ackRes.error.message}`
									);
								}
							})()
						);
					}
				} // End of messages in current stream batch

				if (isShuttingDown) {
					break;
				}

				if (processingPromises.length > 0) {
					const processingStartTime = Date.now();

					logger.info(
						{
							...batchContext,
							stage: "batch_processing",
							messageCount: processingPromises.length,
						},
						"Processing batch concurrently"
					);

					const results = await Promise.allSettled(processingPromises);
					const batchDuration = Date.now() - batchStartTime;
					const processingDuration = Date.now() - processingStartTime;

					let fulfilledCount = 0;
					let rejectedCount = 0;
					results.forEach((result, index) => {
						if (result.status === "fulfilled") {
							fulfilledCount++;
						} else {
							rejectedCount++;
							// Errors from handleMessage or direct ack are already logged internally by those functions.
							// We could log the specific reason for rejection here if needed for a batch summary.
							logger.error(
								{
									...batchContext,
									reason: result.reason,
									taskIndex: index,
									stage: "batch_task_rejected",
								},
								"Task in batch rejected"
							);
						}
					});

					totalMessagesProcessed += fulfilledCount;
					totalBatchesProcessed++;

					const batchSummary = {
						...batchContext,
						fulfilledCount,
						rejectedCount,
						totalCount: processingPromises.length,
						batchDuration,
						processingDuration,
						successRate: (fulfilledCount / processingPromises.length) * 100,
						stage: "batch_complete",
						totalMessagesProcessed,
						totalBatchesProcessed,
					};

					if (rejectedCount > 0) {
						logger.warn(
							batchSummary,
							`Batch processing complete with ${rejectedCount} failures`
						);
					} else {
						logger.info(batchSummary, "Batch processed successfully");
					}
				}
			} // End of streams in response (typically only one: MESSAGE_QUEUE_STREAM)
		} catch (err: any) {
			if (isShuttingDown) {
				break;
			}

			logger.error(
				{
					...workerContext,
					error: err,
					stack: err.stack,
					operation: "processMessages",
					stage: "outer_loop_error",
					totalMessagesProcessed,
					totalBatchesProcessed,
				},
				`Error in message processing loop: ${err.message}. Continuing after delay.`
			);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	const totalDuration = Date.now() - startTime;
	logger.info(
		{
			...workerContext,
			operation: "processMessages",
			stage: "loop_ended",
			totalDuration,
			totalMessagesProcessed,
			totalBatchesProcessed,
			averageMessagesPerBatch:
				totalBatchesProcessed > 0
					? totalMessagesProcessed / totalBatchesProcessed
					: 0,
		},
		"Message processing loop stopped due to shutdown signal"
	);
}

/**
 * Starts the worker process.
 * Checks Redis connection, initializes consumer group, and starts processing messages.
 */
async function startWorker() {
	const startTime = Date.now();

	logger.info(
		{
			...workerContext,
			operation: "startWorker",
			startTime,
		},
		"Starting worker process"
	);

	// Redis connection check
	try {
		const pingStartTime = Date.now();
		const pong = await redis.send("PING", []);
		const pingDuration = Date.now() - pingStartTime;

		if (pong !== "PONG") {
			logger.error(
				{
					...workerContext,
					operation: "startWorker",
					stage: "redis_ping",
					expected: "PONG",
					received: pong,
					pingDuration,
				},
				"Redis PING failed - unexpected response"
			);
			process.exit(1);
		}

		logger.info(
			{
				...workerContext,
				operation: "startWorker",
				stage: "redis_ping",
				pingDuration,
			},
			"Redis PING successful"
		);
	} catch (error: any) {
		logger.error(
			{
				...workerContext,
				error,
				operation: "startWorker",
				stage: "redis_ping",
			},
			"Redis PING failed"
		);
		process.exit(1);
	}

	// Initialize consumer group
	const groupInitResult = await initializeConsumerGroup();
	if (groupInitResult.error) {
		logger.error(
			{
				...workerContext,
				error: groupInitResult.error,
				operation: "startWorker",
				stage: "consumer_group_init",
			},
			"Failed to initialize consumer group. Exiting."
		);
		process.exit(1);
	}

	// Set up signal handlers
	logger.debug(
		{
			...workerContext,
			operation: "startWorker",
			stage: "signal_handlers",
		},
		"Setting up graceful shutdown signal handlers"
	);
	process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
	process.on("SIGINT", () => gracefulShutdown("SIGINT"));

	// Check for pending messages on startup (recovery from previous crashes)
	logger.info(
		{
			...workerContext,
			operation: "startWorker",
			stage: "startup_pending_check",
		},
		"Checking for pending messages from previous worker sessions"
	);
	await checkAndClaimPendingMessages();

	// Start pending message recovery
	pendingRecoveryInterval = startPendingMessageRecovery();

	const initDuration = Date.now() - startTime;
	logger.info(
		{
			...workerContext,
			operation: "startWorker",
			stage: "initialization_complete",
			initDuration,
		},
		"Worker initialization complete. Starting message processing."
	);

	// Start processing messages
	await processMessages();

	const totalDuration = Date.now() - startTime;
	logger.info(
		{
			...workerContext,
			operation: "startWorker",
			stage: "process_messages_finished",
			totalDuration,
		},
		"ProcessMessages finished. Worker might exit if shutdown was not called via signal."
	);
}

startWorker().catch((error) => {
	logger.error(
		{
			...workerContext,
			error,
			stack: error.stack,
			operation: "startWorker",
			stage: "unhandled_error",
			isShuttingDown,
		},
		"Unhandled error in startWorker. Exiting"
	);
	if (!isShuttingDown) {
		process.exit(1);
	}
});

/** Gracefully shuts down the worker. */
async function gracefulShutdown(signal: string) {
	const shutdownStartTime = Date.now();

	logger.info(
		{
			...workerContext,
			operation: "gracefulShutdown",
			signal,
			shutdownStartTime,
		},
		`Received ${signal}. Starting graceful shutdown`
	);

	isShuttingDown = true;

	// Give existing message processing a moment to complete if necessary,
	// but XREADGROUP with BLOCK will mostly handle waiting.
	// The loop will break on the next iteration or when BLOCK times out.

	// Stop pending message recovery
	if (pendingRecoveryInterval) {
		logger.debug(
			{
				...workerContext,
				operation: "gracefulShutdown",
				stage: "stop_pending_recovery",
			},
			"Stopping pending message recovery loop"
		);
		clearInterval(pendingRecoveryInterval);
		pendingRecoveryInterval = null;
	}

	logger.debug(
		{
			...workerContext,
			operation: "gracefulShutdown",
			stage: "closing_redis",
		},
		"Closing Redis connection"
	);

	redis.close();

	const shutdownDuration = Date.now() - shutdownStartTime;
	logger.info(
		{
			...workerContext,
			operation: "gracefulShutdown",
			stage: "shutdown_complete",
			shutdownDuration,
		},
		"Graceful shutdown complete. Exiting."
	);

	process.exit(0);
}
