import { createEnv } from "@t3-oss/env-core";
import { typeid } from "typeid-js";
import { z } from "zod";

export const env = createEnv({
  server: {
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional()
      .default("info"),

    // Retry configuration
    WORKER_MAX_RETRY_ATTEMPTS: z.coerce.number().optional().default(3),
    WORKER_BASE_RETRY_DELAY_MS: z.coerce.number().optional().default(1000),
    WORKER_MAX_ROUND_ROBIN_ATTEMPTS: z.coerce.number().optional().default(3),

    // Consumer configuration
    WORKER_CONSUMER_GROUP_NAME: z
      .string()
      .optional()
      .default("message_consumers"),
    WORKER_CONSUMER_NAME: z
      .string()
      .optional()
      .default(() => typeid("worker").toString()),
    WORKER_BLOCK_TIMEOUT_MS: z.coerce.number().optional().default(5000),
    WORKER_READ_COUNT: z.coerce.number().optional().default(10),

    // Pending message recovery settings
    WORKER_MIN_IDLE_TIME_MS: z.coerce
      .number()
      .optional()
      .default(5 * 60 * 1000), // 5 minutes
    WORKER_PENDING_CHECK_INTERVAL_MS: z.coerce
      .number()
      .optional()
      .default(30 * 1000), // 30 seconds
    WORKER_MAX_CLAIM_COUNT: z.coerce.number().optional().default(5),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
