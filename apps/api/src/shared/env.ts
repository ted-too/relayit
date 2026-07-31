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
  // Cloud edition only — sandbox / inbound DNS on the platform root domain.
  CF_ROOT_DOMAIN: z.string().min(1).optional(),
  CF_API_TOKEN: z.string().min(1).optional(),
  CF_ZONE_ID: z.string().min(1).optional(),
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
  // Cloud edition only — optional at parse time; asserted when EDITION=cloud.
  STRIPE_PRICE_SIGNAL_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_SIGNAL_ANNUAL: z.string().min(1).optional(),
  STRIPE_PRICE_BROADCAST_MONTHLY: z.string().min(1).optional(),
  STRIPE_PRICE_BROADCAST_ANNUAL: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
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

function assertCloudRequired(
  label: string,
  required: Record<string, string | undefined>
) {
  if (!IS_CLOUD_EDITION) {
    return;
  }

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`EDITION=cloud requires ${label}: ${missing.join(", ")}`);
  }
}

/**
 * Cloud edition requires Stripe credentials. OSS/self-host must not.
 * Call from process entrypoints after env load (server also asserts webhook secret).
 */
export function assertCloudStripeEnv(
  extraRequired: Record<string, string | undefined> = {}
) {
  assertCloudRequired("Stripe env", {
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_SIGNAL_MONTHLY: env.STRIPE_PRICE_SIGNAL_MONTHLY,
    STRIPE_PRICE_SIGNAL_ANNUAL: env.STRIPE_PRICE_SIGNAL_ANNUAL,
    STRIPE_PRICE_BROADCAST_MONTHLY: env.STRIPE_PRICE_BROADCAST_MONTHLY,
    STRIPE_PRICE_BROADCAST_ANNUAL: env.STRIPE_PRICE_BROADCAST_ANNUAL,
    ...extraRequired,
  });
}

/** Cloud edition requires Cloudflare for sandbox / inbound DNS. */
export function assertCloudCloudflareEnv() {
  assertCloudRequired("Cloudflare env", {
    CF_ROOT_DOMAIN: env.CF_ROOT_DOMAIN,
    CF_API_TOKEN: env.CF_API_TOKEN,
    CF_ZONE_ID: env.CF_ZONE_ID,
  });
}

/** Cloud edition requires GitHub OAuth for social login. */
export function assertCloudGitHubEnv(values: {
  GITHUB_CLIENT_ID: string | undefined;
  GITHUB_CLIENT_SECRET: string | undefined;
}) {
  assertCloudRequired("GitHub OAuth env", values);
}

/**
 * Runtime guard for Cloudflare DNS ops. Prefer calling only on cloud paths;
 * cloud entrypoints also assert these at startup via `assertCloudCloudflareEnv`.
 */
export function requireCloudflareEnv() {
  const rootDomain = env.CF_ROOT_DOMAIN;
  const apiToken = env.CF_API_TOKEN;
  const zoneId = env.CF_ZONE_ID;

  if (!(rootDomain && apiToken && zoneId)) {
    throw new Error(
      "Cloudflare env (CF_ROOT_DOMAIN, CF_API_TOKEN, CF_ZONE_ID) is required"
    );
  }

  return { rootDomain, apiToken, zoneId };
}
