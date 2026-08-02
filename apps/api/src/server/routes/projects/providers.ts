import type { ChannelCredentials } from "@repo/api/channels/base";
import { verifyProviderTask } from "@repo/api/channels/email/sending-identity/tasks/verify-provider";
import { db } from "@repo/api/db";
import { encryptRecord } from "@repo/api/db/crypto";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import {
  loadBillingUserEmailLimits,
  resolveBillingUserId,
} from "@repo/api/tenancy/billing-user";
import { isByoProvidersAllowed } from "@repo/api/tenancy/entitlements";
import { resolveDefaultManagedEmailProviderId } from "@repo/api/tenancy/project-email";
import {
  createProviderBodySchema,
  providerIdParamsSchema,
  providerVendorParamsSchema,
  updateProviderBodySchema,
} from "@repo/api/validators/routes/projects/providers";
import { Elysia, status } from "elysia";

async function assertByoAllowed(organizationId: string) {
  const billingUserId = await resolveBillingUserId(organizationId);
  if (!billingUserId) {
    return status(500, "Billing User not found for this Project");
  }

  const limits = await loadBillingUserEmailLimits(billingUserId);
  if (!limits) {
    return status(500, "Billing User channel limits not found");
  }

  if (!isByoProvidersAllowed(limits)) {
    return status(
      403,
      "Your plan does not allow bringing your own email Provider"
    );
  }

  return null;
}

export const providersRoutes = new Elysia({ prefix: "/providers" })
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .get("/", async ({ organization, request }) => {
    const hasPermission = await auth.api.hasPermission({
      headers: request.headers,
      body: {
        organizationId: organization.id,
        permissions: { integration: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read providers");
    }

    const [byo, managed, defaultManagedProviderId] = await Promise.all([
      db.query.provider.findMany({
        where: (table, { eq, and }) =>
          and(
            eq(table.scope, "project"),
            eq(table.organizationId, organization.id)
          ),
      }),
      db.query.provider.findMany({
        where: (table, { eq, and }) =>
          and(eq(table.scope, "platform"), eq(table.channelType, "email")),
        columns: {
          id: true,
          channelType: true,
          vendorId: true,
          productId: true,
          scope: true,
          name: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      resolveDefaultManagedEmailProviderId(),
    ]);

    return {
      byo,
      managed,
      defaultManagedProviderId,
    };
  })
  .post(
    "/byVendor/:vendorId/:productId",
    async ({
      body,
      params: { vendorId, productId },
      organization,
      request,
    }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { integration: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create providers");
      }

      const denied = await assertByoAllowed(organization.id);
      if (denied) {
        return denied;
      }

      const config =
        RUNTIME_PROVIDER_REGISTRY[vendorId as RuntimeProviderType]?.products?.[
          productId
        ];

      if (!config) {
        return status(404, "Provider or channel not found");
      }

      const parseResult = config.credentialsSchema.safeParse(body.credentials);
      if (!parseResult.success) {
        return status(400, "Invalid credentials");
      }

      const encryptedCredentialsResult = await encryptRecord(
        parseResult.data.encrypted
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
            unencrypted: parseResult.data.unencrypted,
          },
          name: body.name,
          scope: "project",
          organizationId: organization.id,
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
      params: providerVendorParamsSchema,
      body: createProviderBodySchema,
    }
  )
  .post(
    "/:providerId/verify",
    async ({ params: { providerId }, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { integration: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to verify providers");
      }

      const denied = await assertByoAllowed(organization.id);
      if (denied) {
        return denied;
      }

      const row = await db.query.provider.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, providerId),
            eq(table.scope, "project"),
            eq(table.organizationId, organization.id)
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
    { params: providerIdParamsSchema }
  )
  .patch(
    "/:providerId",
    async ({ body, params: { providerId }, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { integration: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update providers");
      }

      const denied = await assertByoAllowed(organization.id);
      if (denied) {
        return denied;
      }

      const row = await db.query.provider.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, providerId),
            eq(table.scope, "project"),
            eq(table.organizationId, organization.id)
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
      params: providerIdParamsSchema,
      body: updateProviderBodySchema,
    }
  )
  .delete(
    "/:providerId",
    async ({ params: { providerId }, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { integration: ["delete"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to delete providers");
      }

      const row = await db.query.provider.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, providerId),
            eq(table.scope, "project"),
            eq(table.organizationId, organization.id)
          ),
      });

      if (!row) {
        return status(404, "Provider not found");
      }

      const identity = await db.query.emailDomainProviderIdentity.findFirst({
        where: (table, { eq }) => eq(table.providerId, providerId),
        columns: { id: true },
      });

      if (identity) {
        return status(
          400,
          "Remove Domain↔Provider pairings that use this Provider before deleting it"
        );
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
    { params: providerIdParamsSchema }
  );
