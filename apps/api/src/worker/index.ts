import type { Queue, WorkerStream } from "@repo/api/queue";
import type { Task } from "@repo/api/tasks";
import { logger } from "@repo/api/utils";
import { env } from "@repo/api/worker/env";
import { WORKER_QUEUES } from "@repo/api/worker/lib/queue";
import { workerRedis } from "@repo/api/worker/lib/redis";
import { WORKER_TASKS } from "@repo/api/worker/lib/tasks";

// Remove consumers that have been drained and idle this long. Generous so we
// never race a briefly-quiet live worker (which would just re-register anyway).
const PRUNE_IDLE_MS = 30 * 60 * 1000;
const PRUNE_CRON = "*/15 * * * *";
const SHUTDOWN_CLEANUP_TIMEOUT_MS = 3000;

let isShuttingDown = false;

interface StoppableCronJob {
  stop(): void;
}

const cronJobs: StoppableCronJob[] = [];

const consumerHandles: {
  streamName: string;
  stream: WorkerStream<unknown>;
}[] = [];

type WorkerProcessor = Task<unknown> | Queue<unknown>;

// Tasks and queues share the same stream/schedule plumbing; only tasks have a
// `reconcile` schedule-repair pass.
const WORKER_PROCESSORS: WorkerProcessor[] = [
  ...WORKER_TASKS,
  ...WORKER_QUEUES,
];

function supportsReconcile(
  processor: WorkerProcessor
): processor is Task<unknown> {
  return "reconcile" in processor;
}

export async function startWorker() {
  const startTime = Date.now();
  const consumerName = env.WORKER_CONSUMER_NAME;

  logger.debug(
    { operation: "startWorker", logLevel: env.LOG_LEVEL, consumerName },
    "Starting worker process"
  );

  try {
    const pong = await workerRedis.send("PING", []);
    if (pong !== "PONG") {
      logger.error(
        { operation: "startWorker", expected: "PONG", received: pong },
        "Redis PING failed - unexpected response"
      );
      process.exit(1);
    }
  } catch (error) {
    logger.error(
      { operation: "startWorker", error },
      "Redis connection failed"
    );
    process.exit(1);
  }

  for (const workerTask of WORKER_PROCESSORS) {
    try {
      await workerTask.bootstrap(workerRedis, consumerName);
    } catch (error) {
      logger.error(
        { stream: workerTask.stream, error },
        "Failed to initialize stream consumer group"
      );
      process.exit(1);
    }

    const stream = workerTask.workerStream(workerRedis, consumerName);
    consumerHandles.push({ streamName: workerTask.stream, stream });

    cronJobs.push(
      Bun.cron(PRUNE_CRON, async () => {
        if (!isShuttingDown) {
          const result = await stream.pruneIdleConsumers({
            minIdleMs: PRUNE_IDLE_MS,
          });

          if (result.error) {
            logger.error(
              { stream: workerTask.stream, error: result.error },
              "Failed to prune idle consumers"
            );
          } else if (result.data.length > 0) {
            logger.info(
              { stream: workerTask.stream, pruned: result.data },
              "Pruned idle consumers"
            );
          }
        }
      }) as StoppableCronJob
    );

    cronJobs.push(
      Bun.cron(workerTask.worker.promoteCron, async () => {
        if (!isShuttingDown) {
          const result = await stream.promoteDue({
            now: Date.now(),
            limit: workerTask.worker.readCount,
          });

          if (result.error) {
            logger.error(
              { stream: workerTask.stream, error: result.error },
              "Failed to promote due schedule entries"
            );
          } else if (result.data > 0) {
            logger.debug(
              { stream: workerTask.stream, promoted: result.data },
              "Promoted due schedule entries"
            );
          }
        }
      }) as StoppableCronJob
    );

    if (supportsReconcile(workerTask) && workerTask.worker.reconcileCron) {
      const reconcilable = workerTask;
      const reconcileCron = workerTask.worker.reconcileCron;
      cronJobs.push(
        Bun.cron(reconcileCron, async () => {
          if (!isShuttingDown) {
            try {
              await reconcilable.reconcile(workerRedis);
            } catch (error) {
              logger.error(
                { stream: reconcilable.stream, error },
                "Failed to reconcile task schedule"
              );
            }
          }
        }) as StoppableCronJob
      );
    }
  }

  logger.info(
    {
      streams: WORKER_PROCESSORS.map((processor) => processor.stream),
      consumerName,
      initDuration: Date.now() - startTime,
    },
    "Worker ready"
  );

  await Promise.all(
    WORKER_PROCESSORS.map((workerTask) =>
      workerTask.run(workerRedis, consumerName, () => !isShuttingDown)
    )
  );
}

/**
 * Stop the worker's run loops, unregister its consumers, and close the worker
 * Redis connection. Owned by the entrypoint's signal handling — this does not
 * call `process.exit`.
 */
export async function shutdownWorker() {
  isShuttingDown = true;

  for (const job of cronJobs) {
    job.stop();
  }

  // Best-effort: unregister this worker's consumer from every group so restarts
  // don't leave orphaned consumers behind. Bounded so a slow Redis can't hang
  // shutdown; hard crashes are cleaned up by the prune cron instead.
  await Promise.race([
    Promise.allSettled(
      consumerHandles.map(async ({ streamName, stream }) => {
        const result = await stream.deleteConsumer();
        if (result.error) {
          logger.error(
            { stream: streamName, error: result.error },
            "Failed to delete consumer during shutdown"
          );
        } else if (result.data > 0) {
          logger.warn(
            { stream: streamName, pending: result.data },
            "Deleted consumer that still had pending messages"
          );
        }
      })
    ),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_CLEANUP_TIMEOUT_MS)),
  ]);

  workerRedis.close();
}
