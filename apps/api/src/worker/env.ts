import { sharedEnvOptions, sharedServerEnvSchema } from "@repo/api/env";
import { createEnv } from "@t3-oss/env-core";
import { typeid } from "typeid-js";
import { z } from "zod";

export const env = createEnv({
  server: {
    ...sharedServerEnvSchema,
    WORKER_MAX_RETRY_ATTEMPTS: z.coerce.number().optional().default(3),
    WORKER_BASE_RETRY_DELAY_MS: z.coerce.number().optional().default(1000),
    WORKER_MAX_ROUND_ROBIN_ATTEMPTS: z.coerce.number().optional().default(3),

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

    WORKER_MIN_IDLE_TIME_MS: z.coerce
      .number()
      .optional()
      .default(5 * 60 * 1000),
    WORKER_PENDING_CHECK_INTERVAL_MS: z.coerce
      .number()
      .optional()
      .default(30 * 1000),
    WORKER_MAX_CLAIM_COUNT: z.coerce.number().optional().default(5),

    WORKER_ORPHANED_RECOVERY_LIMIT: z.coerce.number().optional().default(50),
    WORKER_ORPHANED_RECOVERY_MAX_AGE_MINUTES: z.coerce
      .number()
      .optional()
      .default(30),

    WORKER_PROCESSING_TIMEOUT_MINUTES: z.coerce.number().optional().default(15),
    WORKER_PROCESSING_RECOVERY_LIMIT: z.coerce.number().optional().default(50),

    WORKER_STREAM_SCAN_TIME_WINDOW_HOURS: z.coerce
      .number()
      .optional()
      .default(1),
    WORKER_STREAM_SCAN_MAX_MESSAGES: z.coerce.number().optional().default(5000),
    WORKER_STREAM_FALLBACK_SCAN_LIMIT: z.coerce
      .number()
      .optional()
      .default(2000),
  },
  ...sharedEnvOptions,
});
