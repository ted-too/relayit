import { createEnv } from "@t3-oss/env-core";
import { typeid } from "typeid-js";
import { z } from "zod";

export const env = createEnv({
  server: {
    REDIS_URL: z.string(),
    DATABASE_URL: z.string(),
    ENCRYPTION_KEY_VERSION: z.string().default("v1"),
    CREDENTIAL_ENCRYPTION_KEY_V1: z.string(),

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

    // Orphaned event recovery settings
    WORKER_ORPHANED_RECOVERY_LIMIT: z.coerce.number().optional().default(50),
    WORKER_ORPHANED_RECOVERY_MAX_AGE_MINUTES: z.coerce
      .number()
      .optional()
      .default(30), // Only recover events newer than 30 minutes

    // Stuck processing event recovery settings
    WORKER_PROCESSING_TIMEOUT_MINUTES: z.coerce.number().optional().default(15), // Events stuck in processing for longer than this are recovered
    WORKER_PROCESSING_RECOVERY_LIMIT: z.coerce.number().optional().default(50),

    // Redis stream duplicate detection settings
    WORKER_STREAM_SCAN_TIME_WINDOW_HOURS: z.coerce
      .number()
      .optional()
      .default(1), // How far back to scan for duplicates (in hours)
    WORKER_STREAM_SCAN_MAX_MESSAGES: z.coerce.number().optional().default(5000), // Maximum messages to scan in time window
    WORKER_STREAM_FALLBACK_SCAN_LIMIT: z.coerce
      .number()
      .optional()
      .default(2000), // Fallback limit when time-based scanning fails
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
