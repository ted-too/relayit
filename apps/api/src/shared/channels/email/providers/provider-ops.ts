import type { ChannelCredentials } from "@repo/api/channels/base";
import type { Provider, ProviderScope } from "@repo/api/db";
import { schema } from "@repo/api/db";
import { env, WEBHOOK_BASE_URL } from "@repo/api/env";
import type { TaskContext } from "@repo/api/tasks";
import { createGenericError, logger, type Result } from "@repo/api/utils";
import { and, eq } from "drizzle-orm";
import { refreshPlatformSpfRecord } from "../sending-identity/identity";
import type { createSandboxDomainOps } from "../sending-identity/sandbox";
import { verifyProviderIdentityTask } from "../sending-identity/tasks/verify-provider-identity";
import { verifySandboxDomainTask } from "../sending-identity/tasks/verify-sandbox-domain";
import type { EmailVendorOps } from "../types";

type SandboxDomainOps = ReturnType<typeof createSandboxDomainOps>;

const TRAILING_SLASH_RE = /\/$/;

export function createProviderOps({
  vendor,
  sandboxDomain: sandboxDomainOps,
}: {
  vendor: EmailVendorOps;
  sandboxDomain: SandboxDomainOps;
}) {
  return {
    async create({
      params,
      ctx: { db, redis },
    }: {
      params: {
        vendorId: string;
        productId: string;
        credentials: ChannelCredentials;
        name: string | null;
      } & (
        | { scope: Extract<ProviderScope, "platform">; isDefault?: boolean }
        | {
            scope: Extract<ProviderScope, "project">;
            organizationId: string;
          }
      );
      ctx: TaskContext;
    }): Promise<Result<Provider>> {
      const connection = await vendor.checkConnection({
        credentials: params.credentials,
      });

      if (!connection.ok) {
        return {
          data: null,
          error: createGenericError(
            "Could not verify the provider credentials. Check the access key and secret, and that the IAM user has the required SES permissions."
          ),
        };
      }

      const provider = await db.transaction(async (tx) => {
        let isDefault = false;
        if (params.scope === "platform") {
          const existingForChannel = await tx.query.provider.findFirst({
            where: (table, { eq: equals, and: combine }) =>
              combine(
                equals(table.scope, "platform"),
                equals(table.channelType, "email")
              ),
            columns: { id: true },
          });
          // First managed backend for the channel is always the default.
          const isFirstForChannel = !existingForChannel;
          isDefault = isFirstForChannel || params.isDefault === true;
          if (isDefault && !isFirstForChannel) {
            await tx
              .update(schema.provider)
              .set({ isDefault: false })
              .where(
                and(
                  eq(schema.provider.scope, "platform"),
                  eq(schema.provider.channelType, "email")
                )
              );
          }
        }

        const [row] = await tx
          .insert(schema.provider)
          .values({
            channelType: "email",
            vendorId: params.vendorId,
            productId: params.productId,
            credentials: params.credentials,
            name: params.name,
            scope: params.scope,
            organizationId:
              params.scope === "project" ? params.organizationId : null,
            isDefault,
          })
          .returning();

        await refreshPlatformSpfRecord({ db: tx });
        return row;
      });

      const webhookUrl = `${WEBHOOK_BASE_URL.replace(TRAILING_SLASH_RE, "")}/webhooks/providers/${params.vendorId}/${params.productId}`;

      if (vendor.webhooks) {
        try {
          await vendor.webhooks.ensureNotifications({
            credentials: params.credentials,
            webhookUrl,
          });
        } catch (error) {
          logger.error(
            { error, providerId: provider.id },
            "Failed to provision provider webhook notifications"
          );
        }
      }

      if (params.scope === "platform") {
        try {
          const existing = await db.query.sandboxDomain.findFirst({
            where: (table, { eq }) => eq(table.rootDomain, env.CF_ROOT_DOMAIN),
          });

          if (existing) {
            const { identityId } = await sandboxDomainOps.addProviderIdentity({
              params: { provider, sandboxDomain: existing },
              ctx: { db, redis },
            });

            await verifyProviderIdentityTask
              .with(redis)
              .enqueue({ identityId });
            await verifySandboxDomainTask
              .with(redis)
              .enqueue({ sandboxDomainId: existing.id });
          } else {
            const { sandboxDomainId } = await sandboxDomainOps.create({
              params: {
                provider,
                rootDomain: env.CF_ROOT_DOMAIN,
                cloudflareZoneId: env.CF_ZONE_ID,
              },
              ctx: { db, redis },
            });

            const identities =
              await db.query.emailDomainProviderIdentity.findMany({
                where: (table, { eq }) =>
                  eq(table.sandboxDomainId, sandboxDomainId),
              });

            for (const identity of identities) {
              await verifyProviderIdentityTask
                .with(redis)
                .enqueue({ identityId: identity.id });
            }

            await verifySandboxDomainTask
              .with(redis)
              .enqueue({ sandboxDomainId });
          }
        } catch (error) {
          logger.error(
            { error, providerId: provider.id },
            "Failed to provision sandbox domain for email provider"
          );
        }
      }

      return { data: provider, error: null };
    },

    async update({
      params,
      ctx: { db },
    }: {
      params: {
        dbProviderId: string;
        credentials?: ChannelCredentials;
        name?: string | null;
      };
      ctx: TaskContext;
    }) {
      const provider = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.provider)
          .set({
            ...(params.credentials === undefined
              ? {}
              : { credentials: params.credentials }),
            ...(params.name === undefined ? {} : { name: params.name }),
          })
          .where(eq(schema.provider.id, params.dbProviderId))
          .returning();

        if (!row) {
          throw new Error(`Provider ${params.dbProviderId} not found`);
        }

        await refreshPlatformSpfRecord({ db: tx });
        return row;
      });

      return provider;
    },

    async delete({
      params,
      ctx: { db },
    }: {
      params: { dbProviderId: string };
      ctx: TaskContext;
    }) {
      const provider = await db.query.provider.findFirst({
        where: (table, { eq }) => eq(table.id, params.dbProviderId),
      });

      if (!provider) {
        return {
          data: null,
          error: createGenericError("Provider not found"),
        };
      }

      const webhookUrl = `${WEBHOOK_BASE_URL.replace(TRAILING_SLASH_RE, "")}/webhooks/providers/${provider.vendorId}/${provider.productId}`;

      if (vendor.webhooks) {
        try {
          await vendor.webhooks.teardownNotifications({
            credentials: provider.credentials,
            webhookUrl,
          });
        } catch (error) {
          logger.warn(
            { error, providerId: provider.id },
            "Failed to teardown provider webhook notifications"
          );
        }
      }

      try {
        await db.transaction(async (tx) => {
          await refreshPlatformSpfRecord({ db: tx });
          await tx
            .delete(schema.provider)
            .where(eq(schema.provider.id, params.dbProviderId));
        });
      } catch (error) {
        return {
          data: null,
          error: createGenericError(
            "Failed to delete provider",
            error as Error
          ),
        };
      }

      return { data: { deleted: true }, error: null };
    },

    async checkConnection({
      params,
      ctx: { db },
    }: {
      params: { dbProviderId: string };
      ctx: TaskContext;
    }) {
      const provider = await db.query.provider.findFirst({
        where: (table, { eq }) => eq(table.id, params.dbProviderId),
      });

      if (!provider) {
        return {
          data: null,
          error: createGenericError("Provider not found"),
        };
      }

      try {
        const connection = await vendor.checkConnection({
          credentials: provider.credentials,
        });

        if (!connection.ok) {
          return {
            data: { status: "invalid-credentials" as const },
            error: null,
          };
        }

        return { data: { status: "ok" as const }, error: null };
      } catch {
        return {
          data: { status: "invalid-credentials" as const },
          error: null,
        };
      }
    },

    async refreshSharedDns({ ctx: { db } }: { ctx: TaskContext }) {
      await db.transaction(async (tx) => {
        await refreshPlatformSpfRecord({ db: tx });
      });

      const shared = await db.query.emailDnsRecord.findMany({
        where: (table, { eq, and }) =>
          and(eq(table.role, "shared"), eq(table.purpose, "spf")),
      });

      const allActive =
        shared.length > 0 &&
        shared.every((record) => record.status === "active");

      const nextCheckAt = new Date(
        Date.now() + (allActive ? 12 * 60 * 60 * 1000 : 2 * 60 * 1000)
      );

      return { allActive, nextCheckAt };
    },
  };
}
