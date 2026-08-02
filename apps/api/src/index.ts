import cluster from "node:cluster";
import os from "node:os";
import { db } from "@repo/api/db";
import { env } from "@repo/api/env";
import { logger } from "@repo/api/utils";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function startServers() {
  // In dev, run a single in-process server so `--watch` stays simple and we
  // avoid a fleet of forks. In production, fork one server per core.
  if (env.DEV === "true") {
    const { startServer } = await import("./server");
    startServer();
    return;
  }

  for (let i = 0; i < os.availableParallelism(); i++) {
    cluster.fork();
  }
}

// Upper bound on the whole shutdown sequence so a stuck step (slow Redis,
// draining connection) can never wedge the process forever.
const SHUTDOWN_TIMEOUT_MS = 8000;

function registerGracefulShutdown(steps: Array<() => Promise<void>>) {
  let shuttingDown = false;

  const run = async (signal: string) => {
    if (shuttingDown) {
      logger.warn({ signal }, "Shutdown already in progress; forcing exit");
      process.exit(1);
    }
    shuttingDown = true;

    logger.info({ signal }, "Received signal. Starting graceful shutdown");

    try {
      await Promise.race([
        (async () => {
          for (const step of steps) {
            await step();
          }
        })(),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
    } catch (error) {
      logger.error({ error }, "Error during graceful shutdown");
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => void run("SIGTERM"));
  process.on("SIGINT", () => void run("SIGINT"));
}

async function runBootstrap() {
  await migrate(db, { migrationsFolder: "./drizzle" });
}

async function main() {
  // Forked children only serve HTTP. They re-enter this entrypoint, so we bail
  // out here before bootstrap (migrations must run once) and before the worker
  // (the queue consumer must not be duplicated per fork).
  if (!cluster.isPrimary) {
    const { startServer } = await import("./server");
    startServer();
    return;
  }

  await runBootstrap();

  switch (env.RUN_MODE) {
    case "worker": {
      const { startWorker, shutdownWorker } = await import("./worker");
      registerGracefulShutdown([shutdownWorker]);
      return startWorker();
    }

    case "api": {
      const { stopServer } = await import("./server");
      registerGracefulShutdown([stopServer]);
      return startServers();
    }

    case "combined": {
      // The single worker lives in the primary; its run loops block forever, so
      // it is started without awaiting before starting the server(s).
      const { startWorker, shutdownWorker } = await import("./worker");
      const { stopServer } = await import("./server");
      // Drain HTTP first (stops new work + closes apiRedis), then wind down the
      // worker loops and unregister its consumers.
      registerGracefulShutdown([stopServer, shutdownWorker]);
      startWorker().catch((error) => {
        logger.error(error, "Worker runtime crashed");
        process.exit(1);
      });
      return startServers();
    }

    case "builder": {
      const { startBuilder, stopBuilder } = await import("./builder");
      registerGracefulShutdown([stopBuilder]);
      return startBuilder();
    }

    default: {
      throw new Error(`Unsupported RUN_MODE: ${env.RUN_MODE}`);
    }
  }
}

main().catch((error) => {
  logger.error(error, "Failed to start runtime");
  process.exit(1);
});
