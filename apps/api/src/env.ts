import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const runtimeModes = ["combined", "api", "worker"] as const;

export const logLevels = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export const sharedServerEnvSchema = {
  DEV: z.enum(["true", "false"]).optional().default("false"),
  RUN_MODE: z.enum(runtimeModes).optional().default("combined"),
  REDIS_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY_VERSION: z.string().optional().default("v1"),
  LOG_LEVEL: z.enum(logLevels).optional().default("info"),
} satisfies Record<string, z.ZodTypeAny>;

export const sharedEnvOptions = {
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
} as const;

export const env = createEnv({
  server: sharedServerEnvSchema,
  ...sharedEnvOptions,
});

export type RunMode = (typeof runtimeModes)[number];
