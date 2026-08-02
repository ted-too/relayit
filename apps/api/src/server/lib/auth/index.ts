/** biome-ignore-all lint/suspicious/useAwait: this is needed for the plugins */
import { apiKey } from "@better-auth/api-key";
import { stripe } from "@better-auth/stripe";
import { db, schema } from "@repo/api/db";
import { parseBetterAuthSecretsEnv } from "@repo/api/db/crypto";
import { IS_CLOUD_EDITION } from "@repo/api/env";
import { env } from "@repo/api/server/env";
import { BASE_PATH, COOKIE_PREFIX } from "@repo/api/server/lib/auth/constants";
import { sharedCookieDomain } from "@repo/api/server/lib/auth/cookie-domain";
import {
  ac as organizationAc,
  admin as organizationAdminRole,
  member as organizationMemberRole,
  owner as organizationOwnerRole,
} from "@repo/api/server/lib/auth/permissions";
import {
  isBillingUser,
  setBillingUserId,
} from "@repo/api/tenancy/billing-user";
import { ensureUserLimits, plans } from "@repo/api/tenancy/plans";
import { provisionProjectEmailChannel } from "@repo/api/tenancy/project-email";
import { ensureUserProvisioned } from "@repo/api/tenancy/provisioning";
import { getStripeClient } from "@repo/api/tenancy/stripe";
import { logger } from "@repo/api/utils";
import { APIError, type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { admin, lastLoginMethod, organization } from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import { RedisClient } from "bun";

async function assertNotBillingUser(organizationId: string, userId: string) {
  if (await isBillingUser(organizationId, userId)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Reassign the Billing User before leaving or removing this member from the Project",
    });
  }
}

const authRedis = new RedisClient(env.REDIS_URL);

/** Docs SSO is cloud-only; ignore DOCS_URL on OSS even if present. */
const docsUrl = IS_CLOUD_EDITION ? env.DOCS_URL : undefined;

const options = {
  basePath: BASE_PATH,
  baseURL: {
    allowedHosts: (() => {
      const apiHostname = new URL(env.API_URL).hostname.toLowerCase();
      const appHostname = new URL(env.APP_URL).hostname.toLowerCase();
      const docsHostname = docsUrl
        ? new URL(docsUrl).hostname.toLowerCase()
        : undefined;

      return [
        apiHostname,
        appHostname,
        ...(docsHostname ? [docsHostname] : []),
      ];
    })(),
  },
  secrets: parseBetterAuthSecretsEnv(env.BETTER_AUTH_SECRETS),
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
    get: async (key) => await authRedis.get(`relayit:auth:${key}`),
    set: async (key, value, ttl) => {
      await authRedis.set(`relayit:auth:${key}`, value);
      if (ttl) {
        await authRedis.expire(`relayit:auth:${key}`, ttl);
      }
    },
    delete: async (key) => {
      await authRedis.del(`relayit:auth:${key}`);
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  hooks: {
    // leaveOrganization does not invoke organizationHooks.beforeRemoveMember in
    // this better-auth version — guard it on the leave path explicitly.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/organization/leave") {
        return;
      }

      const body = ctx.body as { organizationId?: string } | undefined;
      const organizationId = body?.organizationId;
      if (!organizationId) {
        return;
      }

      const session = await getSessionFromCtx(ctx);
      const userId = session?.user?.id;
      if (!userId) {
        return;
      }

      await assertNotBillingUser(organizationId, userId);
    }),
    // Self-healing provisioning net: whenever a session is established
    // (sign-in / sign-up / social callback) make sure the user is on their
    // current plan — limits, `user_channel` rows, and (cloud) a sandbox root for
    // any org missing one. Idempotent and best-effort; failures never block auth.
    after: createAuthMiddleware(async (ctx) => {
      const userId = ctx.context.newSession?.user?.id;

      if (!userId) {
        return;
      }

      try {
        await ensureUserProvisioned(userId);
      } catch (error) {
        logger.error(error, "Failed to provision user on session creation");
      }
    }),
  },
  advanced: {
    // Share session cookies across app/api/(docs) when they share a parent
    // domain — required for web SSR, which forwards Cookie from APP_URL to
    // the API. See https://better-auth.com/docs/concepts/cookies
    crossSubDomainCookies: (() => {
      const domain = sharedCookieDomain(
        env.APP_URL,
        env.API_URL,
        ...(docsUrl ? [docsUrl] : [])
      );
      return domain ? { enabled: true, domain } : undefined;
    })(),
    database: {
      generateId: false,
    },
    cookiePrefix: COOKIE_PREFIX,
  },
  socialProviders:
    IS_CLOUD_EDITION && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {},
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
  trustedOrigins: [env.APP_URL, ...(docsUrl ? [docsUrl] : [])],
  plugins: [
    admin(),
    ...(IS_CLOUD_EDITION
      ? [
          stripe({
            stripeClient: getStripeClient(),
            stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
            createCustomerOnSignUp: true,
            subscription: {
              enabled: true,
              requireEmailVerification: true,
              plans,
              authorizeReference: async ({ user, referenceId }) => {
                // customerType='user' means referenceId === user.id, so just confirm self.
                return referenceId === user.id;
              },
              // Checkout finished: apply the new plan's limits.
              onSubscriptionComplete: async ({ subscription }) => {
                await ensureUserLimits(
                  subscription.referenceId,
                  subscription.plan
                );
              },
              // Created outside checkout (e.g. Stripe dashboard): same sync.
              onSubscriptionCreated: async ({ subscription }) => {
                await ensureUserLimits(
                  subscription.referenceId,
                  subscription.plan
                );
              },
              // Plan switch / status change / scheduled change taking effect.
              // Only re-sync while usable; teardown is handled on deletion.
              onSubscriptionUpdate: async ({ subscription }) => {
                if (
                  subscription.status === "active" ||
                  subscription.status === "trialing"
                ) {
                  await ensureUserLimits(
                    subscription.referenceId,
                    subscription.plan
                  );
                }
              },
              // Subscription has actually ended: revert to free-plan limits.
              onSubscriptionDeleted: async ({ subscription }) => {
                await ensureUserLimits(subscription.referenceId);
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
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user }) => {
          await setBillingUserId(organization.id, user.id);
          try {
            await provisionProjectEmailChannel(organization.id);
          } catch (error) {
            logger.error(
              { error, organizationId: organization.id },
              "Failed to provision Project email channel on create"
            );
          }
        },
        beforeRemoveMember: async ({ member, organization }) => {
          await assertNotBillingUser(organization.id, member.userId);
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
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  plugins: [...(options.plugins ?? [])],
});
