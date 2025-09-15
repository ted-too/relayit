import {
  acknowledgeEvent,
  claimPendingEvents,
  getPendingEvents,
  MESSAGE_QUEUE_STREAM,
  readEvents,
  recoverOrphanedEvents,
  recoverStuckProcessingEvents,
} from "@repo/shared/db";
import { createGenericError, logger } from "@repo/shared/utils";
import { redis } from "bun";
import { env } from "./env";
import { processMessageEvent } from "./lib/process-event";

let isShuttingDown = false;
let pendingRecoveryInterval: NodeJS.Timeout | null = null;

const workerContext: Record<string, any> = {
  workerId: env.WORKER_CONSUMER_NAME,
  consumerGroup: env.WORKER_CONSUMER_GROUP_NAME,
  stream: MESSAGE_QUEUE_STREAM,
  concurrency: env.WORKER_READ_COUNT,
  blockTimeout: env.WORKER_BLOCK_TIMEOUT_MS,
};

async function initializeConsumerGroup(): Promise<{ error: any; data: any }> {
  const startTime = Date.now();

  logger.debug(
    { ...workerContext, operation: "initializeConsumerGroup" },
    "Initializing Redis consumer group"
  );

  try {
    await redis.send("XGROUP", [
      "CREATE",
      MESSAGE_QUEUE_STREAM,
      env.WORKER_CONSUMER_GROUP_NAME,
      "0",
      "MKSTREAM",
    ]);

    const duration = Date.now() - startTime;
    logger.info(
      {
        ...workerContext,
        operation: "initializeConsumerGroup",
        duration,
        created: true,
      },
      `Consumer group '${env.WORKER_CONSUMER_GROUP_NAME}' created successfully`
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
        `Consumer group '${env.WORKER_CONSUMER_GROUP_NAME}' already exists`
      );
      return { error: null, data: undefined };
    }

    const errMessage = `Failed to create/verify consumer group '${env.WORKER_CONSUMER_GROUP_NAME}'`;
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

// Recovery logic for stuck processing events
async function checkAndRecoverStuckProcessingEvents(): Promise<void> {
  const startTime = Date.now();

  logger.debug(
    {
      ...workerContext,
      operation: "checkAndRecoverStuckProcessingEvents",
      timeoutMinutes: env.WORKER_PROCESSING_TIMEOUT_MINUTES,
    },
    "Checking for stuck processing events"
  );

  try {
    const recoveryResult = await recoverStuckProcessingEvents(
      env.WORKER_PROCESSING_TIMEOUT_MINUTES,
      env.WORKER_PROCESSING_RECOVERY_LIMIT
    );

    if (recoveryResult.error) {
      logger.error(
        {
          ...workerContext,
          operation: "checkAndRecoverStuckProcessingEvents",
          error: recoveryResult.error,
        },
        "Failed to recover stuck processing events"
      );
      return;
    }

    const { recovered, failed } = recoveryResult.data;
    const total = recovered + failed;

    if (total > 0) {
      logger.warn(
        {
          ...workerContext,
          operation: "checkAndRecoverStuckProcessingEvents",
          recovered,
          failed,
          total,
          timeoutMinutes: env.WORKER_PROCESSING_TIMEOUT_MINUTES,
          duration: Date.now() - startTime,
        },
        `Processing recovery completed: ${recovered} recovered, ${failed} failed (events stuck > ${env.WORKER_PROCESSING_TIMEOUT_MINUTES}min)`
      );
    } else {
      logger.debug(
        {
          ...workerContext,
          operation: "checkAndRecoverStuckProcessingEvents",
          duration: Date.now() - startTime,
        },
        "No stuck processing events found"
      );
    }
  } catch (error) {
    logger.error(
      {
        ...workerContext,
        operation: "checkAndRecoverStuckProcessingEvents",
        error,
        duration: Date.now() - startTime,
      },
      `Error in stuck processing event recovery: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Recovery logic for orphaned database events
async function checkAndRecoverOrphanedEvents(): Promise<void> {
  const startTime = Date.now();

  logger.debug(
    {
      ...workerContext,
      operation: "checkAndRecoverOrphanedEvents",
    },
    "Checking for orphaned queued events in database"
  );

  try {
    const recoveryResult = await recoverOrphanedEvents(
      env.WORKER_CONSUMER_GROUP_NAME,
      env.WORKER_ORPHANED_RECOVERY_LIMIT,
      env.WORKER_ORPHANED_RECOVERY_MAX_AGE_MINUTES,
      {
        timeWindowHours: env.WORKER_STREAM_SCAN_TIME_WINDOW_HOURS,
        maxMessagesInWindow: env.WORKER_STREAM_SCAN_MAX_MESSAGES,
        fallbackScanLimit: env.WORKER_STREAM_FALLBACK_SCAN_LIMIT,
      }
    );

    if (recoveryResult.error) {
      logger.error(
        {
          ...workerContext,
          operation: "checkAndRecoverOrphanedEvents",
          error: recoveryResult.error,
        },
        "Failed to recover orphaned events"
      );
      return;
    }

    const { recovered, skipped, failed } = recoveryResult.data;
    const total = recovered + skipped + failed;

    if (total > 0) {
      logger.info(
        {
          ...workerContext,
          operation: "checkAndRecoverOrphanedEvents",
          recovered,
          skipped,
          failed,
          total,
          duration: Date.now() - startTime,
        },
        `Database recovery completed: ${recovered} recovered, ${skipped} skipped, ${failed} failed`
      );
    } else {
      logger.debug(
        {
          ...workerContext,
          operation: "checkAndRecoverOrphanedEvents",
          duration: Date.now() - startTime,
        },
        "No orphaned events found in database"
      );
    }
  } catch (error) {
    logger.error(
      {
        ...workerContext,
        operation: "checkAndRecoverOrphanedEvents",
        error,
        duration: Date.now() - startTime,
      },
      `Error in orphaned event recovery: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Recovery logic for crashed worker events
async function checkAndClaimPendingEvents(): Promise<void> {
  const startTime = Date.now();

  logger.debug(
    {
      ...workerContext,
      operation: "checkAndClaimPendingEvents",
      minIdleTimeMs: env.WORKER_MIN_IDLE_TIME_MS,
      maxClaimCount: env.WORKER_MAX_CLAIM_COUNT,
    },
    "Checking for pending events to claim"
  );

  try {
    const pendingResult = await getPendingEvents(
      env.WORKER_CONSUMER_GROUP_NAME,
      10
    );
    if (pendingResult.error) {
      logger.error(
        {
          ...workerContext,
          operation: "checkAndClaimPendingEvents",
          stage: "get_pending_info",
          error: pendingResult.error,
        },
        "Failed to get pending event info"
      );
      return;
    }

    const { summary } = pendingResult.data;

    if (summary?.totalPending > 0) {
      logger.info(
        {
          ...workerContext,
          operation: "checkAndClaimPendingEvents",
          stage: "pending_summary",
          totalPending: summary.totalPending,
        },
        `Found ${summary.totalPending} pending events in consumer group`
      );

      const claimResult = await claimPendingEvents(
        env.WORKER_CONSUMER_GROUP_NAME,
        env.WORKER_CONSUMER_NAME,
        env.WORKER_MIN_IDLE_TIME_MS,
        env.WORKER_MAX_CLAIM_COUNT
      );

      if (claimResult.error) {
        logger.error(
          {
            ...workerContext,
            operation: "checkAndClaimPendingEvents",
            stage: "claim_events",
            error: claimResult.error,
          },
          "Failed to claim pending events"
        );
        return;
      }

      const claimedEvents = claimResult.data;
      if (claimedEvents.length > 0) {
        logger.info(
          {
            ...workerContext,
            operation: "checkAndClaimPendingEvents",
            stage: "events_claimed",
            claimedCount: claimedEvents.length,
          },
          `Successfully claimed ${claimedEvents.length} abandoned events`
        );

        // Process claimed events
        const processingPromises = claimedEvents.map(
          async ([streamId, fields]) => {
            let eventId: string | null = null;
            for (let i = 0; i < fields.length; i += 2) {
              if (fields[i] === "eventId") {
                eventId = fields[i + 1] || null;
                break;
              }
            }

            try {
              if (eventId) {
                await processMessageEvent(
                  eventId,
                  streamId,
                  env.WORKER_CONSUMER_GROUP_NAME
                );
              }
            } finally {
              // Always acknowledge Redis stream entry to prevent reprocessing
              const ackResult = await acknowledgeEvent(
                streamId,
                env.WORKER_CONSUMER_GROUP_NAME
              );
              if (ackResult.error) {
                logger.error(
                  {
                    ...workerContext,
                    operation: "checkAndClaimPendingEvents",
                    eventId,
                    streamId,
                    error: ackResult.error,
                    stage: "acknowledgment_claimed",
                  },
                  "CRITICAL: Failed to acknowledge claimed event"
                );
              }
            }
          }
        );

        await Promise.allSettled(processingPromises);
      }
    }
  } catch (error) {
    logger.error(
      {
        ...workerContext,
        operation: "checkAndClaimPendingEvents",
        error,
        duration: Date.now() - startTime,
      },
      `Error in pending event check: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

async function processEvents(): Promise<void> {
  const startTime = Date.now();
  let totalEventsProcessed = 0;
  let totalBatchesProcessed = 0;

  logger.info(
    {
      ...workerContext,
      operation: "processEvents",
      startTime,
    },
    "Starting event processing loop"
  );

  while (!isShuttingDown) {
    try {
      const eventsResult = await readEvents(
        env.WORKER_CONSUMER_GROUP_NAME,
        env.WORKER_CONSUMER_NAME,
        env.WORKER_READ_COUNT,
        env.WORKER_BLOCK_TIMEOUT_MS
      );

      if (eventsResult.error) {
        logger.error(
          {
            ...workerContext,
            operation: "processEvents",
            error: eventsResult.error,
            stage: "read_events",
          },
          "Failed to read events from stream"
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      const events = eventsResult.data;
      if (events.length === 0) continue;

      const batchStartTime = Date.now();
      const batchContext = {
        ...workerContext,
        operation: "processBatch",
        batchSize: events.length,
        batchId: `batch_${Date.now()}`,
      };

      logger.debug(batchContext, `Processing batch of ${events.length} events`);

      // Process events concurrently with acknowledgment
      const processingPromises = events.map(async (event) => {
        try {
          await processMessageEvent(
            event.fields.eventId,
            event.id,
            env.WORKER_CONSUMER_GROUP_NAME
          );
        } finally {
          // Always acknowledge Redis stream entry to prevent reprocessing
          const ackResult = await acknowledgeEvent(
            event.id,
            env.WORKER_CONSUMER_GROUP_NAME
          );
          if (ackResult.error) {
            logger.error(
              {
                ...batchContext,
                eventId: event.fields.eventId,
                streamId: event.id,
                error: ackResult.error,
                stage: "acknowledgment",
              },
              "CRITICAL: Failed to acknowledge event"
            );
          }
        }
      });

      const results = await Promise.allSettled(processingPromises);
      const batchDuration = Date.now() - batchStartTime;

      let successCount = 0;
      let failureCount = 0;
      for (const result of results) {
        if (result.status === "fulfilled") {
          successCount++;
        } else {
          failureCount++;
        }
      }

      totalEventsProcessed += successCount;
      totalBatchesProcessed++;

      const batchSummary = {
        ...batchContext,
        successCount,
        failureCount,
        totalCount: events.length,
        batchDuration,
        successRate: (successCount / events.length) * 100,
        stage: "batch_complete",
        totalEventsProcessed,
        totalBatchesProcessed,
      };

      if (failureCount > 0) {
        logger.warn(
          batchSummary,
          `Batch completed with ${failureCount} failures`
        );
      } else {
        logger.info(batchSummary, "Batch processed successfully");
      }
    } catch (error) {
      if (isShuttingDown) break;

      logger.error(
        {
          ...workerContext,
          error,
          operation: "processEvents",
          stage: "outer_loop_error",
          totalEventsProcessed,
          totalBatchesProcessed,
        },
        `Error in event processing loop: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  logger.info(
    {
      ...workerContext,
      operation: "processEvents",
      stage: "loop_ended",
      totalDuration: Date.now() - startTime,
      totalEventsProcessed,
      totalBatchesProcessed,
    },
    "Event processing loop stopped due to shutdown signal"
  );
}

async function startWorker() {
  const startTime = Date.now();

  logger.info(
    {
      ...workerContext,
      operation: "startWorker",
      logLevel: env.LOG_LEVEL,
      maxRetryAttempts: env.WORKER_MAX_RETRY_ATTEMPTS,
      maxRoundRobinAttempts: env.WORKER_MAX_ROUND_ROBIN_ATTEMPTS,
    },
    "Starting worker process"
  );

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
      "Redis connection verified"
    );
  } catch (error) {
    logger.error(
      {
        ...workerContext,
        error,
        operation: "startWorker",
        stage: "redis_ping",
      },
      "Redis connection failed"
    );
    process.exit(1);
  }

  const groupInitResult = await initializeConsumerGroup();
  if (groupInitResult.error) {
    logger.error(
      {
        ...workerContext,
        error: groupInitResult.error,
        operation: "startWorker",
        stage: "consumer_group_init",
      },
      "Failed to initialize consumer group"
    );
    process.exit(1);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  logger.info(
    {
      ...workerContext,
      operation: "startWorker",
      stage: "startup_recovery",
    },
    "Running startup recovery checks"
  );

  // First, recover events stuck in processing (crashed workers)
  await checkAndRecoverStuckProcessingEvents();

  // Second, recover any orphaned events from the database
  await checkAndRecoverOrphanedEvents();

  // Finally, claim any pending events from Redis
  await checkAndClaimPendingEvents();

  pendingRecoveryInterval = setInterval(async () => {
    if (!isShuttingDown) {
      // Run all recovery mechanisms periodically
      await checkAndRecoverStuckProcessingEvents();
      await checkAndRecoverOrphanedEvents();
      await checkAndClaimPendingEvents();
    }
  }, env.WORKER_PENDING_CHECK_INTERVAL_MS);

  logger.info(
    {
      ...workerContext,
      operation: "startWorker",
      stage: "initialization_complete",
      initDuration: Date.now() - startTime,
    },
    "Worker initialization complete. Starting event processing."
  );

  await processEvents();
}

function gracefulShutdown(signal: string) {
  const shutdownStartTime = Date.now();

  logger.info(
    {
      ...workerContext,
      operation: "gracefulShutdown",
      signal,
    },
    `Received ${signal}. Starting graceful shutdown`
  );

  isShuttingDown = true;

  if (pendingRecoveryInterval) {
    clearInterval(pendingRecoveryInterval);
    pendingRecoveryInterval = null;
  }

  redis.close();

  logger.info(
    {
      ...workerContext,
      operation: "gracefulShutdown",
      stage: "shutdown_complete",
      shutdownDuration: Date.now() - shutdownStartTime,
    },
    "Graceful shutdown complete"
  );

  process.exit(0);
}

// Start the worker
startWorker().catch((error) => {
  logger.error(
    {
      ...workerContext,
      error,
      operation: "startWorker",
      stage: "unhandled_error",
    },
    "Unhandled error in startWorker"
  );
  process.exit(1);
});
