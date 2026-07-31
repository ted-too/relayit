import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const runtimeModes = ["combined", "api", "worker", "builder"] as const;

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
  EDITION: z.enum(["oss", "cloud"]).optional().default("oss"),
  RUN_MODE: z.enum(runtimeModes).optional().default("combined"),
  REDIS_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY_VERSION: z.string().optional().default("v1"),
  LOG_LEVEL: z.enum(logLevels).optional().default("info"),
  CF_ROOT_DOMAIN: z.string().min(1),
  CF_API_TOKEN: z.string().min(1),
  CF_ZONE_ID: z.string().min(1),
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().min(1).default("auto"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1).default("relayit"),
  API_URL: z.url(),
  // Public base URL for provider webhook callbacks (e.g. SNS)
  API_PROXY_URL: z.url().optional(),
  // Shared by HTTP auth and tokenized links (e.g. unsubscribe HMAC).
  BETTER_AUTH_SECRET: z.string().min(1),
  // Plan price ids — consumed by shared tenancy plan definitions.
  STRIPE_PRICE_SIGNAL_MONTHLY: z.string().min(1),
  STRIPE_PRICE_SIGNAL_ANNUAL: z.string().min(1),
  STRIPE_PRICE_BROADCAST_MONTHLY: z.string().min(1),
  STRIPE_PRICE_BROADCAST_ANNUAL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  /**
   * Private templating-builder base URL. When unset, the API runs Git/Publish
   * ops in-process (dev / single-service deployments).
   */
  TEMPLATING_BUILDER_URL: z.url().optional(),
  /** Shared bearer secret for API → builder private calls. */
  TEMPLATING_BUILDER_SECRET: z.string().min(1).optional(),
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

export const IS_CLOUD_EDITION = env.EDITION === "cloud";

/** Base URL used to register provider webhook callbacks (SNS, DMARC inbound). */
export const WEBHOOK_BASE_URL = env.API_PROXY_URL ?? env.API_URL;
