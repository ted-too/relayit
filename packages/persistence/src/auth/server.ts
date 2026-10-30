import { apiKey } from "@better-auth/api-key";
import { type StripeOptions, stripe } from "@better-auth/stripe";
import {
  type BetterAuthOptions,
  betterAuth,
  type SocialProviders,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  lastLoginMethod,
  type OrganizationOptions,
  organization,
} from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import type { PromiseDb } from "../db/promise";
import * as schema from "../db/schema";
import { COOKIE_PREFIX } from "./constants";
import {
  ac as organizationAc,
  admin as organizationAdminRole,
  member as organizationMemberRole,
  owner as organizationOwnerRole,
} from "./permissions";
import {
  BROADCAST_LIMITS,
  ensureUserLimits,
  FREE_LIMITS,
  SIGNAL_LIMITS,
} from "./plans";

interface AuthStripePlanPriceIds {
  annualPriceId: string;
  monthlyPriceId: string;
}

/**
 * Raw-command Redis surface for session storage. Satisfied by
 * `@repo/redis`'s self-healing client (preferred) and by Bun's `RedisClient`.
 */
export interface AuthRedis {
  readonly send: (command: string, args: string[]) => Promise<unknown>;
}

export interface AuthConfig {
  baseUrl?: string;
  /**
   * Parent domain for the session cookie (e.g. `relayit.io`), so sibling
   * subdomains like the marketing site can see that a user is signed in.
   * Omit to keep cookies host-only.
   */
  cookieDomain?: string;
  db: PromiseDb;
  hooks?: BetterAuthOptions["hooks"];
  plugins?: {
    organization?: {
      hooks: OrganizationOptions["organizationHooks"];
    };
    stripe?: {
      client: StripeOptions["stripeClient"];
      webhookSecret: StripeOptions["stripeWebhookSecret"];
      plans: {
        signal: AuthStripePlanPriceIds;
        broadcast: AuthStripePlanPriceIds;
      };
    };
  };
  redis: AuthRedis;
  socialProviders?: SocialProviders;
}

export const createAuth = ({
  baseUrl,
  cookieDomain,
  db,
  redis,
  socialProviders,
  hooks,
  plugins,
}: AuthConfig) =>
  betterAuth({
    baseURL: baseUrl,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    session: {
      cookieCache: {
        maxAge: 5 * 60,
        refreshCache: false,
      },
    },
    secondaryStorage: {
      get: async (key) => {
        const value = await redis.send("GET", [`${COOKIE_PREFIX}:auth:${key}`]);
        return typeof value === "string" ? value : null;
      },
      set: async (key, value, ttl) => {
        const redisKey = `${COOKIE_PREFIX}:auth:${key}`;
        if (ttl) {
          await redis.send("SETEX", [redisKey, String(ttl), value]);
        } else {
          await redis.send("SET", [redisKey, value]);
        }
      },
      delete: async (key) => {
        await redis.send("DEL", [`${COOKIE_PREFIX}:auth:${key}`]);
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    socialProviders,
    hooks,
    advanced: {
      database: {
        generateId: false,
      },
      cookiePrefix: COOKIE_PREFIX,
      ...(cookieDomain
        ? { crossSubDomainCookies: { domain: cookieDomain, enabled: true } }
        : {}),
    },
    user: {
      additionalFields: {
        limitOrganizations: {
          type: "number",
          required: false,
          input: false,
        },
        limitRetention: {
          type: "number",
          required: false,
          input: false,
        },
      },
    },
    plugins: [
      admin(),
      ...(plugins?.stripe
        ? [
            stripe({
              stripeClient: plugins.stripe.client,
              stripeWebhookSecret: plugins.stripe.webhookSecret,
              createCustomerOnSignUp: true,
              subscription: {
                enabled: true,
                requireEmailVerification: true,
                plans: [
                  {
                    name: "free",
                    limits: FREE_LIMITS,
                  },
                  {
                    name: "signal",
                    limits: SIGNAL_LIMITS,
                    priceId: plugins.stripe.plans.signal.monthlyPriceId,
                    annualDiscountPriceId:
                      plugins.stripe.plans.signal.annualPriceId,
                  },
                  {
                    name: "broadcast",
                    limits: BROADCAST_LIMITS,
                    priceId: plugins.stripe.plans.broadcast.monthlyPriceId,
                    annualDiscountPriceId:
                      plugins.stripe.plans.broadcast.annualPriceId,
                  },
                ],
                authorizeReference: async ({ user, referenceId }) =>
                  referenceId === user.id,
                onSubscriptionComplete: async ({ subscription }) => {
                  await ensureUserLimits(db, {
                    userId: subscription.referenceId,
                    planName: subscription.plan,
                  });
                },
                onSubscriptionCreated: async ({ subscription }) => {
                  await ensureUserLimits(db, {
                    userId: subscription.referenceId,
                    planName: subscription.plan,
                  });
                },
                onSubscriptionUpdate: async ({ subscription }) => {
                  if (
                    subscription.status === "active" ||
                    subscription.status === "trialing"
                  ) {
                    await ensureUserLimits(db, {
                      userId: subscription.referenceId,
                      planName: subscription.plan,
                    });
                  }
                },
                onSubscriptionDeleted: async ({ subscription }) => {
                  await ensureUserLimits(db, {
                    userId: subscription.referenceId,
                    planName: "free",
                  });
                },
              },
            }),
          ]
        : []),
      emailHarmony(),
      organization({
        ac: organizationAc,
        roles: {
          owner: organizationOwnerRole,
          admin: organizationAdminRole,
          member: organizationMemberRole,
        },
        schema: {
          organization: {
            additionalFields: {
              billingUserId: {
                type: "string",
                required: false,
                input: false,
              },
            },
          },
        },
        organizationHooks: plugins?.organization?.hooks,
      }),
      lastLoginMethod(),
      apiKey([
        {
          rateLimit: { enabled: true },
          configId: "user-keys",
          defaultPrefix: "rel_user_",
          references: "user",
          enableMetadata: false,
        },
        {
          rateLimit: { enabled: false },
          configId: "org-keys",
          defaultPrefix: "rel_org_",
          references: "organization",
          enableMetadata: true,
        },
      ]),
    ],
  });

export type Auth = ReturnType<typeof createAuth>;
export { APIError } from "better-auth";
export { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
