import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().optional(),
    HOST: z.string().optional(),
    BETTER_AUTH_URL: z.string().min(1),
    BETTER_AUTH_SECRETS: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

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
    /** Cloudflare — enables Sandbox Domains (ops inventory + auto DNS). */
    CF_API_TOKEN: z.string().min(1).optional(),
    CF_ROOT_DOMAIN: z.string().min(1).optional(),
    CF_ZONE_ID: z.string().min(1).optional(),
    /**
     * Template builder (Effect Rpc). Required for workspace Git ops;
     * catalog list/create works without it.
     */
    TEMPLATING_BUILDER_URL: z.string().url().optional(),
    TEMPLATING_BUILDER_SECRET: z.string().min(1).optional(),
  },
  clientPrefix: "VITE_",
  client: {
    VITE_DEBUG: z
      .enum(["true", "false"])
      .optional()
      .default("false")
      .transform((val) => val === "true"),
  },
  runtimeEnv: {
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRETS: process.env.BETTER_AUTH_SECRETS,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,

    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_SIGNAL_MONTHLY: process.env.STRIPE_PRICE_SIGNAL_MONTHLY,
    STRIPE_PRICE_SIGNAL_ANNUAL: process.env.STRIPE_PRICE_SIGNAL_ANNUAL,
    STRIPE_PRICE_BROADCAST_MONTHLY: process.env.STRIPE_PRICE_BROADCAST_MONTHLY,
    STRIPE_PRICE_BROADCAST_ANNUAL: process.env.STRIPE_PRICE_BROADCAST_ANNUAL,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    CF_API_TOKEN: process.env.CF_API_TOKEN,
    CF_ROOT_DOMAIN: process.env.CF_ROOT_DOMAIN,
    CF_ZONE_ID: process.env.CF_ZONE_ID,
    TEMPLATING_BUILDER_URL: process.env.TEMPLATING_BUILDER_URL,
    TEMPLATING_BUILDER_SECRET: process.env.TEMPLATING_BUILDER_SECRET,
    VITE_DEBUG: import.meta.env.VITE_DEBUG,
  },
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
