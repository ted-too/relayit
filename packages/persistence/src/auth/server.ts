import { apiKey } from "@better-auth/api-key";
import { type StripeOptions, stripe } from "@better-auth/stripe";
import { APIError, type BetterAuthOptions, betterAuth, type SocialProviders } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  lastLoginMethod,
  type OrganizationOptions,
  organization,
} from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import { ProjectSlug } from "@repo/contracts/dashboard";
import { Result, Schema } from "effect";
import type { PromiseDb } from "../db/promise";
import * as schema from "../db/schema";
import { AUTH_BASE_PATH, COOKIE_PREFIX } from "./constants";
import {
  ac as organizationAc,
  admin as organizationAdminRole,
  member as organizationMemberRole,
  owner as organizationOwnerRole,
} from "./permissions";
import { BROADCAST_LIMITS, ensureUserLimits, FREE_LIMITS, SIGNAL_LIMITS } from "./plans";

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
  /** The api's public origin (`API_URL`); better-auth is at `/auth` on it. */
  baseUrl?: string;
  /**
   * Parent domain for the session cookie (e.g. `relayit.io`), so sibling
   * subdomains like the marketing site can see that a user is signed in.
   * Omit to keep cookies host-only (the api's host).
   */
  cookieDomain?: string;
  db: PromiseDb;
  /**
   * Where a sign-in failure better-auth can't send back to the page's own
   * `errorCallbackURL` lands (an OAuth callback whose state is gone, its `/error` page): the
   * dashboard's sign-in page. Without it the browser is left on the api's origin.
   */
  errorUrl?: string;
  hooks?: BetterAuthOptions["hooks"];
  /**
   * Limits requests to `/auth/*` per client IP, in Redis. better-auth would decide by
   * `NODE_ENV`, which the images leave unset; the app decides instead.
   */
  rateLimit: boolean;
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
  /**
   * Origins besides the api's own that may call better-auth with the session cookie and be
   * redirected to after sign-in: the dashboard's (`APP_URL`).
   */
  trustedOrigins?: string[];
  /** `REDIS_KEY_PREFIX`: the session store bypasses `@repo/redis`, so it applies it here. */
  redisKeyPrefix: string;
  socialProviders?: SocialProviders;
}

/** better-auth's refusal of a slug `ProjectSlug` doesn't take, with the rule it broke. */
const refuseInvalidSlug = (slug: string | undefined) => {
  if (slug === undefined) {
    return;
  }
  const checked = Schema.decodeUnknownResult(ProjectSlug)(slug);
  if (Result.isFailure(checked)) {
    throw new APIError("BAD_REQUEST", { message: checked.failure.message });
  }
};

export const createAuth = ({
  baseUrl,
  cookieDomain,
  db,
  errorUrl,
  redis,
  redisKeyPrefix,
  socialProviders,
  hooks,
  plugins,
  rateLimit,
  trustedOrigins,
}: AuthConfig) =>
  betterAuth({
    baseURL: baseUrl,
    basePath: AUTH_BASE_PATH,
    trustedOrigins,
    onAPIError: { errorURL: errorUrl },
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
        const value = await redis.send("GET", [`${redisKeyPrefix}${COOKIE_PREFIX}:auth:${key}`]);
        return typeof value === "string" ? value : null;
      },
      set: async (key, value, ttl) => {
        const redisKey = `${redisKeyPrefix}${COOKIE_PREFIX}:auth:${key}`;
        if (ttl) {
          await redis.send("SETEX", [redisKey, String(ttl), value]);
        } else {
          await redis.send("SET", [redisKey, value]);
        }
      },
      delete: async (key) => {
        await redis.send("DEL", [`${redisKeyPrefix}${COOKIE_PREFIX}:auth:${key}`]);
      },
      getAndDelete: async (key) => {
        const value = await redis.send("GETDEL", [`${redisKeyPrefix}${COOKIE_PREFIX}:auth:${key}`]);
        return typeof value === "string" ? value : null;
      },
      // The TTL is set only when the counter is created, in the same step, so a window
      // never outlives its first request and a crash can't leave a counter without one.
      increment: async (key, ttl) =>
        Number(
          await redis.send("EVAL", [
            "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n",
            "1",
            `${redisKeyPrefix}${COOKIE_PREFIX}:auth:${key}`,
            String(ttl),
          ]),
        ),
    },
    emailAndPassword: {
      enabled: true,
    },
    socialProviders,
    hooks,
    rateLimit: { enabled: rateLimit },
    advanced: {
      database: {
        generateId: false,
      },
      cookiePrefix: COOKIE_PREFIX,
      // better-auth skips its origin and callback URL checks under NODE_ENV=test; the
      // integration tests must see the trusted origins production enforces.
      disableOriginCheck: false,
      ...(cookieDomain ? { crossSubDomainCookies: { domain: cookieDomain, enabled: true } } : {}),
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
                    annualDiscountPriceId: plugins.stripe.plans.signal.annualPriceId,
                  },
                  {
                    name: "broadcast",
                    limits: BROADCAST_LIMITS,
                    priceId: plugins.stripe.plans.broadcast.monthlyPriceId,
                    annualDiscountPriceId: plugins.stripe.plans.broadcast.annualPriceId,
                  },
                ],
                authorizeReference: async ({ user, referenceId }) => referenceId === user.id,
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
                  if (subscription.status === "active" || subscription.status === "trialing") {
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
        // Every Project's slug is checked here, whoever creates or renames it: the
        // dashboard, better-auth's own endpoints, the seed.
        organizationHooks: {
          ...plugins?.organization?.hooks,
          beforeCreateOrganization: async (data) => {
            refuseInvalidSlug(data.organization.slug);
            return plugins?.organization?.hooks?.beforeCreateOrganization?.(data);
          },
          beforeUpdateOrganization: async (data) => {
            refuseInvalidSlug(data.organization.slug);
            return plugins?.organization?.hooks?.beforeUpdateOrganization?.(data);
          },
        },
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

export { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
export { APIError };
