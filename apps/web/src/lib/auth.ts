import { allocateSandboxDomain } from "@repo/channels/email/sandbox";
import { ensureUserLimits } from "@repo/persistence/auth/plans";
import {
  APIError,
  type AuthConfig,
  createAuth,
  createAuthMiddleware,
  getSessionFromCtx,
} from "@repo/persistence/auth/server";
import { createPromiseDb } from "@repo/persistence/db/promise";
import { organization, user } from "@repo/persistence/db/schema";
import { RedisClient } from "bun";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import Stripe from "stripe";
import { env } from "@/env";
import { AppLive } from "@/lib/layers";

const db = createPromiseDb({ databaseUrl: env.DATABASE_URL });
const redis = new RedisClient(env.REDIS_URL);

const stripeConfig =
  env.STRIPE_SECRET_KEY &&
  env.STRIPE_WEBHOOK_SECRET &&
  env.STRIPE_PRICE_SIGNAL_MONTHLY &&
  env.STRIPE_PRICE_SIGNAL_ANNUAL &&
  env.STRIPE_PRICE_BROADCAST_MONTHLY &&
  env.STRIPE_PRICE_BROADCAST_ANNUAL
    ? ({
        client: new Stripe(env.STRIPE_SECRET_KEY, {
          apiVersion: "2026-05-27.dahlia",
        }),
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        plans: {
          signal: {
            monthlyPriceId: env.STRIPE_PRICE_SIGNAL_MONTHLY,
            annualPriceId: env.STRIPE_PRICE_SIGNAL_ANNUAL,
          },
          broadcast: {
            monthlyPriceId: env.STRIPE_PRICE_BROADCAST_MONTHLY,
            annualPriceId: env.STRIPE_PRICE_BROADCAST_ANNUAL,
          },
        },
      } satisfies NonNullable<AuthConfig["plugins"]>["stripe"])
    : undefined;

export const auth = createAuth({
  db,
  redis,
  socialProviders:
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : undefined,
  plugins: {
    organization: {
      hooks: {
        afterCreateOrganization: async ({
          organization: org,
          user: createdBy,
        }) => {
          await db
            .update(organization)
            .set({ billingUserId: createdBy.id })
            .where(eq(organization.id, org.id));

          await Effect.runPromise(
            allocateSandboxDomain(org.id).pipe(
              Effect.provide(AppLive),
              Effect.catchTag("SandboxAllocateError", () =>
                Effect.succeed(null)
              )
            )
          );
        },
        beforeRemoveMember: async ({ member: removed, organization: org }) => {
          const row = await db.query.organization.findFirst({
            where: { id: org.id },
            columns: { billingUserId: true },
            with: {
              members: {
                where: { role: "owner" },
                columns: { userId: true },
                limit: 1,
              },
            },
          });

          const billingUserId =
            row?.billingUserId ?? row?.members[0]?.userId ?? null;

          if (billingUserId === removed.userId) {
            throw new APIError("BAD_REQUEST", {
              message:
                "Reassign the Billing User before leaving or removing this member from the Project",
            });
          }
        },
      },
    },
    stripe: stripeConfig,
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

      const org = await db.query.organization.findFirst({
        where: { id: organizationId },
        columns: { billingUserId: true },
        with: {
          members: {
            where: { role: "owner" },
            columns: { userId: true },
            limit: 1,
          },
        },
      });

      const billingUserId =
        org?.billingUserId ?? org?.members[0]?.userId ?? null;

      if (billingUserId === userId) {
        throw new APIError("BAD_REQUEST", {
          message:
            "Reassign the Billing User before leaving or removing this member from the Project",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const userId = ctx.context.newSession?.user?.id;

      if (!userId) {
        return;
      }

      // FIXME: resolve the user's current plan before syncing — calling
      // without planName resets paid users to free limits.
      await ensureUserLimits(db, { userId });

      if (stripeConfig) {
        const row = await db.query.user.findFirst({
          where: { id: userId },
          columns: {
            id: true,
            email: true,
            name: true,
            stripeCustomerId: true,
          },
        });

        if (row && !row.stripeCustomerId) {
          const existing = await stripeConfig.client.customers.list({
            email: row.email,
            limit: 1,
          });

          const customer =
            existing.data[0] ??
            (await stripeConfig.client.customers.create({
              email: row.email,
              name: row.name,
              metadata: { userId: row.id },
            }));

          await db
            .update(user)
            .set({ stripeCustomerId: customer.id })
            .where(and(eq(user.id, row.id), isNull(user.stripeCustomerId)));
        }
      }

      const memberOrgs = await db.query.organization.findMany({
        where: {
          sandboxDomainId: { isNull: true },
          members: { userId },
        },
        columns: { id: true },
      });

      for (const org of memberOrgs) {
        await Effect.runPromise(
          allocateSandboxDomain(org.id).pipe(
            Effect.provide(AppLive),
            Effect.catchTag("SandboxAllocateError", () => Effect.succeed(null))
          )
        );
      }
    }),
  },
});
