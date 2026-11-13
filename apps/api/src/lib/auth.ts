import { RESERVED_PROJECT_SLUGS } from "@repo/contracts/dashboard";
import { allocateSandboxDomain } from "@repo/channels/email/sandbox";
import { failureAnnotations } from "@repo/logging";
import { syncSessionUserLimits } from "@repo/persistence/auth/plans";
import {
  APIError,
  type Auth,
  type AuthConfig,
  createAuth,
  createAuthMiddleware,
  getSessionFromCtx,
} from "@repo/persistence/auth/server";
import type { DB } from "@repo/persistence/db/effect";
import { createPromiseDb, type PromiseDb } from "@repo/persistence/db/promise";
import { organization, user } from "@repo/persistence/db/schema";
import { makeRedisClient } from "@repo/redis";
import { and, eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import Stripe from "stripe";
import type { ApiConfig } from "../env";

const BILLING_USER_LEAVING =
  "Reassign the Billing User before leaving or removing this member from the Project";

/**
 * better-auth, which serves `/api/auth/*`, resolves dashboard sessions and verifies API
 * keys, and the promise database its hooks and the key lookups use. Both are closed when
 * the layer is released.
 */
export class ApiAuth extends Context.Service<
  ApiAuth,
  { readonly auth: Auth; readonly db: PromiseDb }
>()("api/ApiAuth") {
  static readonly layer = (
    config: Pick<
      ApiConfig,
      | "appUrl"
      | "authCookieDomain"
      | "databaseUrl"
      | "github"
      | "redisKeyPrefix"
      | "redisUrl"
      | "stripe"
    > & { readonly rateLimit: boolean },
  ) =>
    Layer.effect(
      ApiAuth,
      Effect.gen(function* () {
        // The pool and the Redis client report connection trouble from callbacks, and
        // better-auth's hooks are promises; run those effects with the app's services.
        const services = yield* Effect.context<DB>();
        const runFork = (effect: Effect.Effect<void>) => Effect.runForkWith(services)(effect);
        const runPromise = <A, E>(effect: Effect.Effect<A, E, DB>) =>
          Effect.runPromiseWith(services)(effect);
        const db = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createPromiseDb({
              databaseUrl: Redacted.value(config.databaseUrl),
              onPoolError: (error) =>
                runFork(
                  Effect.logWarning("Database connection dropped; pool will reconnect", error).pipe(
                    Effect.annotateLogs({ connection: "auth" }),
                  ),
                ),
            }),
          ),
          (db) => Effect.promise(() => db.$client.end()),
        );
        const redis = yield* Effect.acquireRelease(
          Effect.sync(() =>
            makeRedisClient({
              onReconnect: (event) =>
                runFork(
                  Effect.logWarning(
                    "Redis connection lost; replaced client and retried",
                    event.cause,
                  ).pipe(
                    Effect.annotateLogs({
                      code: event.code,
                      command: event.command,
                      connection: "auth",
                    }),
                  ),
                ),
              url: Redacted.value(config.redisUrl),
            }),
          ),
          (redis) => Effect.sync(() => redis.close()),
        );

        const stripe = Option.getOrUndefined(
          Option.map(
            config.stripe,
            (stripe) =>
              ({
                client: new Stripe(Redacted.value(stripe.secretKey), {
                  apiVersion: "2026-05-27.dahlia",
                }),
                plans: {
                  broadcast: {
                    annualPriceId: stripe.priceBroadcastAnnual,
                    monthlyPriceId: stripe.priceBroadcastMonthly,
                  },
                  signal: {
                    annualPriceId: stripe.priceSignalAnnual,
                    monthlyPriceId: stripe.priceSignalMonthly,
                  },
                },
                webhookSecret: Redacted.value(stripe.webhookSecret),
              }) satisfies NonNullable<AuthConfig["plugins"]>["stripe"],
          ),
        );

        // A Project without a Sandbox Domain gets one when one is allocatable; if none is,
        // it waits for the next sign-in.
        const allocateSandbox = (organizationId: string) =>
          runPromise(
            allocateSandboxDomain(organizationId).pipe(
              Effect.annotateLogs({ organizationId }),
              Effect.tapError((error) =>
                Effect.logWarning("Sandbox Domain allocation skipped").pipe(
                  Effect.annotateLogs(failureAnnotations(error)),
                ),
              ),
              Effect.catchTags({ SandboxAllocateError: () => Effect.succeed(null) }),
            ),
          );

        const billingUserOf = async (organizationId: string) => {
          const row = await db.query.organization.findFirst({
            columns: { billingUserId: true },
            where: { id: organizationId },
            with: {
              members: { columns: { userId: true }, limit: 1, where: { role: "owner" } },
            },
          });
          return row?.billingUserId ?? row?.members[0]?.userId ?? null;
        };

        const refuseReservedSlug = (slug: string | undefined) => {
          if (slug !== undefined && RESERVED_PROJECT_SLUGS.has(slug)) {
            throw new APIError("BAD_REQUEST", { message: "That slug is reserved." });
          }
        };

        const auth = createAuth({
          baseUrl: config.appUrl.origin,
          cookieDomain: Option.getOrUndefined(config.authCookieDomain),
          db,
          rateLimit: config.rateLimit,
          hooks: {
            // leaveOrganization does not invoke organizationHooks.beforeRemoveMember in
            // this better-auth version: guard the leave path explicitly.
            before: createAuthMiddleware(async (ctx) => {
              if (ctx.path !== "/organization/leave") {
                return;
              }
              const organizationId = (ctx.body as { organizationId?: string } | undefined)
                ?.organizationId;
              if (!organizationId) {
                return;
              }
              const session = await getSessionFromCtx(ctx);
              const userId = session?.user?.id;
              if (userId && (await billingUserOf(organizationId)) === userId) {
                throw new APIError("BAD_REQUEST", { message: BILLING_USER_LEAVING });
              }
            }),
            after: createAuthMiddleware(async (ctx) => {
              const userId = ctx.context.newSession?.user?.id;
              if (!userId) {
                return;
              }

              await syncSessionUserLimits(db, { stripeConfigured: Boolean(stripe), userId });

              if (stripe) {
                const row = await db.query.user.findFirst({
                  columns: { email: true, id: true, name: true, stripeCustomerId: true },
                  where: { id: userId },
                });
                if (row && !row.stripeCustomerId) {
                  const existing = await stripe.client.customers.list({
                    email: row.email,
                    limit: 1,
                  });
                  const customer =
                    existing.data[0] ??
                    (await stripe.client.customers.create({
                      email: row.email,
                      metadata: { userId: row.id },
                      name: row.name,
                    }));
                  await db
                    .update(user)
                    .set({ stripeCustomerId: customer.id })
                    .where(and(eq(user.id, row.id), isNull(user.stripeCustomerId)));
                }
              }

              const withoutSandbox = await db.query.organization.findMany({
                columns: { id: true },
                where: { members: { userId }, sandboxDomainId: { isNull: true } },
              });
              for (const { id } of withoutSandbox) {
                await allocateSandbox(id);
              }
            }),
          },
          plugins: {
            organization: {
              hooks: {
                afterCreateOrganization: async ({ organization: created, user: createdBy }) => {
                  await db
                    .update(organization)
                    .set({ billingUserId: createdBy.id })
                    .where(eq(organization.id, created.id));
                  await allocateSandbox(created.id);
                },
                beforeCreateOrganization: async ({ organization: created }) => {
                  refuseReservedSlug(created.slug);
                },
                beforeRemoveMember: async ({ member: removed, organization: from }) => {
                  if ((await billingUserOf(from.id)) === removed.userId) {
                    throw new APIError("BAD_REQUEST", { message: BILLING_USER_LEAVING });
                  }
                },
                beforeUpdateOrganization: async ({ organization: updated }) => {
                  refuseReservedSlug(updated.slug);
                },
              },
            },
            stripe,
          },
          redis,
          redisKeyPrefix: config.redisKeyPrefix,
          socialProviders: Option.getOrUndefined(
            Option.map(config.github, (github) => ({
              github: {
                clientId: github.clientId,
                clientSecret: Redacted.value(github.clientSecret),
              },
            })),
          ),
        });
        return { auth, db };
      }),
    );
}
