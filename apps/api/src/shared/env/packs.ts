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

export type RunMode = (typeof runtimeModes)[number];

/** Process knobs + Redis — every run mode. */
export const processBasePack = {
  DEV: z.enum(["true", "false"]).optional().default("false"),
  EDITION: z.enum(["oss", "cloud"]).optional().default("oss"),
  RUN_MODE: z.enum(runtimeModes).optional().default("combined"),
  LOG_LEVEL: z.enum(logLevels).optional().default("info"),
  REDIS_URL: z.string().min(1),
} satisfies z.ZodRawShape;

/** Postgres + encryption key version. */
export const dbPack = {
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY_VERSION: z.string().optional().default("v1"),
} satisfies z.ZodRawShape;

/** Object storage (R2 / S3-compatible). */
export const s3Pack = {
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().min(1).default("auto"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1).default("relayit"),
} satisfies z.ZodRawShape;

/**
 * Public API URL + HMAC secret for tokenized links (unsubscribe).
 * Required for api / worker / combined — not builder.
 */
export const publicUrlPack = {
  API_URL: z.url(),
  API_PROXY_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(1),
} satisfies z.ZodRawShape;

/** Cloudflare DNS (sandbox / inbound). Optional at parse; asserted when EDITION=cloud. */
export const cloudflarePack = {
  CF_ROOT_DOMAIN: z.string().min(1).optional(),
  CF_API_TOKEN: z.string().min(1).optional(),
  CF_ZONE_ID: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

/** Stripe prices + secret. Optional at parse; asserted when EDITION=cloud. */
export const stripePack = {
  STRIPE_PRICE_SIGNAL_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_SIGNAL_ANNUAL: z.string().min(1).optional(),
  STRIPE_PRICE_BROADCAST_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_BROADCAST_ANNUAL: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

/**
 * API → builder client. URL unset = in-process Git/Publish.
 * Secret shared with the builder process for bearer auth.
 */
export const builderClientPack = {
  TEMPLATING_BUILDER_URL: z.url().optional(),
  TEMPLATING_BUILDER_SECRET: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

/** HTTP listen bind (api / builder). */
export const httpListenPack = {
  PORT: z.coerce.number().int().positive().optional(),
  HOST: z.string().optional().default("0.0.0.0"),
} satisfies z.ZodRawShape;

/** API HTTP process extras (auth, logging, cloud OAuth / webhook). */
export const apiHttpPack = {
  REQUEST_LOGGING_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("false"),
  APP_URL: z.url(),
  DOCS_URL: z.url().optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
} satisfies z.ZodRawShape;

export const corePack = {
  ...processBasePack,
  ...dbPack,
  ...s3Pack,
} satisfies z.ZodRawShape;
