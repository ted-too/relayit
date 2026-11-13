import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().optional(),
    HOST: z.string().optional(),
    BETTER_AUTH_SECRETS: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    /** Prepended to every Redis key; a worktree sets its own. Empty in production. */
    REDIS_KEY_PREFIX: z.string().default(""),
    /** `ses` or `fake`; unset, fake under NODE_ENV development or test, else SES. */
    EMAIL_BACKEND: z.enum(["ses", "fake"]).optional(),
    /**
     * The deployment's SES account, needed by EMAIL_BACKEND=ses: Domains are registered
     * in the first of SES_REGIONS (comma-separated).
     */
    SES_ACCESS_KEY_ID: z.string().min(1).optional(),
    SES_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    SES_REGIONS: z.string().min(1).optional(),

    /** Stripe — enables Plans / Billing. Absent ⇒ unlimited entitlements. */
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_PRICE_SIGNAL_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_SIGNAL_ANNUAL: z.string().min(1).optional(),
    STRIPE_PRICE_BROADCAST_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_BROADCAST_ANNUAL: z.string().min(1).optional(),
    /** GitHub OAuth — enables social sign-in. */
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    /**
     * Template builder (Effect Rpc). Required for workspace Git ops;
     * catalog list/create works without it.
     */
    TEMPLATING_BUILDER_URL: z.url().optional(),
    TEMPLATING_BUILDER_SECRET: z.string().min(1).optional(),
    /**
     * Parent domain for the session cookie (e.g. `relayit.io`) so the
     * marketing site can tell a visitor is signed in. Omit for host-only.
     */
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    LOG_LEVEL: z
      .enum(["All", "Fatal", "Error", "Warn", "Info", "Debug", "Trace", "None"])
      .optional(),
  },
  clientPrefix: "VITE_",
  client: {
    VITE_BASE_URL: z.string().min(1),
    VITE_DEBUG: z
      .enum(["true", "false"])
      .optional()
      .default("false")
      .transform((val) => val === "true"),
  },
  runtimeEnv: {
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX,
    EMAIL_BACKEND: process.env.EMAIL_BACKEND,
    SES_ACCESS_KEY_ID: process.env.SES_ACCESS_KEY_ID,
    SES_SECRET_ACCESS_KEY: process.env.SES_SECRET_ACCESS_KEY,
    SES_REGIONS: process.env.SES_REGIONS,

    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_SIGNAL_MONTHLY: process.env.STRIPE_PRICE_SIGNAL_MONTHLY,
    STRIPE_PRICE_SIGNAL_ANNUAL: process.env.STRIPE_PRICE_SIGNAL_ANNUAL,
    STRIPE_PRICE_BROADCAST_MONTHLY: process.env.STRIPE_PRICE_BROADCAST_MONTHLY,
    STRIPE_PRICE_BROADCAST_ANNUAL: process.env.STRIPE_PRICE_BROADCAST_ANNUAL,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    TEMPLATING_BUILDER_URL: process.env.TEMPLATING_BUILDER_URL,
    TEMPLATING_BUILDER_SECRET: process.env.TEMPLATING_BUILDER_SECRET,
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN,
    LOG_LEVEL: process.env.LOG_LEVEL,
    VITE_BASE_URL: import.meta.env.VITE_BASE_URL,
    VITE_DEBUG: import.meta.env.VITE_DEBUG,
  },
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
