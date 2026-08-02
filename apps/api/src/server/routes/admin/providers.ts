import type { ChannelCredentials } from "@repo/api/channels/base";
import { verifyProviderTask } from "@repo/api/channels/email/sending-identity/tasks/verify-provider";
import { db, schema } from "@repo/api/db";
import { encryptRecord } from "@repo/api/db/crypto";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { betterAuthIsAdmin } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import { logger } from "@repo/api/utils";
import {
  adminProviderIdParamsSchema,
  adminProviderVendorParamsSchema,
  createAdminProviderBodySchema,
  updateAdminProviderBodySchema,
} from "@repo/api/validators/routes/admin/providers";
import { and, eq } from "drizzle-orm";
import { Elysia, status } from "elysia";

async function assertManagedBackendUnused(providerId: string) {
  const identity = await db.query.emailDomainProviderIdentity.findFirst({
    where: (table, { eq: equals }) => equals(table.providerId, providerId),
    columns: { id: true },
  });

  if (identity) {
    return "Managed backend is still referenced by a Domain or Sandbox pairing";
  }

  return null;
}

export const adminProvidersRoutes = new Elysia({ prefix: "/providers" })
  .use(betterAuthIsAdmin)
  .guard({
    auth: true,
    isAdmin: true,
  })
  .get("/", async () =>
    db.query.provider.findMany({
      where: (table, { eq: equals }) => equals(table.scope, "platform"),
    })
  )
  .post(
    "/byVendor/:vendorId/:productId",
    async ({ body, params: { vendorId, productId } }) => {
      const config =
        RUNTIME_PROVIDER_REGISTRY[vendorId as RuntimeProviderType]?.products?.[
          productId
        ];

      if (!config) {
        return status(404, "Provider or channel not found");
      }

      const parseResult = config.credentialsSchema.safeParse(body.credentials);
      if (!parseResult.success) {
        logger.error(
          { error: parseResult.error, vendorId, productId },
          "Invalid credentials"
        );
        return status(400, "Invalid credentials");
      }

      const rawCredentials = parseResult.data;
      const encryptedCredentialsResult = await encryptRecord(
        rawCredentials.encrypted
      );

      if (encryptedCredentialsResult.error) {
        return status(500, "Failed to encrypt credentials");
      }

      const result = await config.provider.create({
        params: {
          vendorId,
          productId,
          credentials: {
            encrypted: encryptedCredentialsResult.data,
            unencrypted: rawCredentials.unencrypted,
          },
          name: body.name,
          scope: "platform",
          isDefault: body.isDefault,
        },
        ctx: { db, redis: apiRedis },
      });

      if (result.error) {
        return status(400, result.error.message);
      }

      await verifyProviderTask
        .with(apiRedis)
        .enqueue({ providerId: result.data.id });

      return result.data;
    },
    {
      params: adminProviderVendorParamsSchema,
      body: createAdminProviderBodySchema,
    }
  )
  .post(
    "/:providerId/verify",
    async ({ params: { providerId } }) => {
      const row = await db.query.provider.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, providerId),
            equals(table.scope, "platform")
          ),
      });

      if (!row) {
        return status(404, "Provider not found");
      }

      const config =
        RUNTIME_PROVIDER_REGISTRY[row.vendorId as RuntimeProviderType]
          ?.products?.[row.productId];

      if (!config) {
        return status(404, "Provider or channel not found");
      }

      const result = await config.provider.checkConnection({
        params: { dbProviderId: providerId },
        ctx: { db, redis: apiRedis },
      });

      if (result.error) {
        return status(400, result.error.message);
      }

      return result.data;
    },
    { params: adminProviderIdParamsSchema }
  )
  .post(
    "/:providerId/setDefault",
    async ({ params: { providerId } }) => {
      const row = await db.query.provider.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, providerId),
            equals(table.scope, "platform"),
            equals(table.channelType, "email")
          ),
      });

      if (!row) {
        return status(404, "Provider not found");
      }

      await db.transaction(async (tx) => {
        await tx
          .update(schema.provider)
          .set({ isDefault: false })
          .where(
            and(
              eq(schema.provider.scope, "platform"),
              eq(schema.provider.channelType, "email")
            )
          );
        await tx
          .update(schema.provider)
          .set({ isDefault: true })
          .where(eq(schema.provider.id, providerId));
      });

      return { id: providerId, isDefault: true };
    },
    { params: adminProviderIdParamsSchema }
  )
  .patch(
    "/:providerId",
    async ({ body, params: { providerId } }) => {
      const row = await db.query.provider.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, providerId),
            equals(table.scope, "platform")
          ),
      });

      if (!row) {
        return status(404, "Provider not found");
      }

      const config =
        RUNTIME_PROVIDER_REGISTRY[row.vendorId as RuntimeProviderType]
          ?.products?.[row.productId];

      if (!config) {
        return status(404, "Provider or channel not found");
      }

      let credentials: ChannelCredentials | undefined;
      if (body.credentials?.encrypted) {
        const parseResult = config.credentialsSchema.safeParse({
          encrypted: body.credentials.encrypted,
          unencrypted:
            body.credentials.unencrypted ?? row.credentials.unencrypted,
        });
        if (!parseResult.success) {
          return status(400, "Invalid credentials");
        }

        const encryptedCredentialsResult = await encryptRecord(
          parseResult.data.encrypted
        );
        if (encryptedCredentialsResult.error) {
          return status(500, "Failed to encrypt credentials");
        }

        credentials = {
          encrypted: encryptedCredentialsResult.data,
          unencrypted: parseResult.data.unencrypted,
        };
      }

      if (body.isDefault === true) {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.provider)
            .set({ isDefault: false })
            .where(
              and(
                eq(schema.provider.scope, "platform"),
                eq(schema.provider.channelType, "email")
              )
            );
          await tx
            .update(schema.provider)
            .set({ isDefault: true })
            .where(eq(schema.provider.id, providerId));
        });
      }

      return await config.provider.update({
        params: {
          dbProviderId: providerId,
          credentials,
          name: body.name,
        },
        ctx: { db, redis: apiRedis },
      });
    },
    {
      params: adminProviderIdParamsSchema,
      body: updateAdminProviderBodySchema,
    }
  )
  .delete(
    "/:providerId",
    async ({ params: { providerId } }) => {
      const row = await db.query.provider.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, providerId),
            equals(table.scope, "platform")
          ),
      });

      if (!row) {
        return status(404, "Provider not found");
      }

      const blocked = await assertManagedBackendUnused(providerId);
      if (blocked) {
        return status(400, blocked);
      }

      const config =
        RUNTIME_PROVIDER_REGISTRY[row.vendorId as RuntimeProviderType]
          ?.products?.[row.productId];

      if (!config) {
        return status(404, "Provider or channel not found");
      }

      const result = await config.provider.delete({
        params: { dbProviderId: providerId },
        ctx: { db, redis: apiRedis },
      });

      if (result.error) {
        return status(400, result.error.message);
      }

      return result.data;
    },
    { params: adminProviderIdParamsSchema }
  );
