import { db } from "@repo/api/db";
import {
  checkAndRunKeyRotation,
  validateEncryptionKeysForStartup,
} from "@repo/api/db/crypto";
import { env } from "@repo/api/env";
import { logger } from "@repo/api/utils";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });

  const keyValidationResult = await validateEncryptionKeysForStartup(db);
  if (keyValidationResult.error) {
    throw keyValidationResult.error;
  }

  const keyRotationResult = await checkAndRunKeyRotation(db);
  if (keyRotationResult.error) {
    throw keyRotationResult.error;
  }

  switch (env.RUN_MODE) {
    case "api": {
      const { startServer } = await import("./server");
      await startServer();
      return;
    }

    case "worker": {
      const { startWorker } = await import("./worker");
      await startWorker();
      return;
    }

    case "combined": {
      const [{ startServer }, { startWorker }] = await Promise.all([
        import("./server"),
        import("./worker"),
      ]);

      await Promise.all([startServer(), startWorker()]);
      return;
    }

    default: {
      const unsupportedRunMode: never = env.RUN_MODE;
      throw new Error(`Unsupported RUN_MODE: ${unsupportedRunMode}`);
    }
  }
}

main().catch((error) => {
  logger.error({ error, runMode: env.RUN_MODE }, "Failed to start runtime");
  process.exit(1);
});
