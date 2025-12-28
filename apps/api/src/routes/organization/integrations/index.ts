import { auth } from "@repo/api/lib/auth";
import { activeOrganization, betterAuth } from "@repo/api/lib/auth-handler";
import { identitiesRoutes } from "@repo/api/routes/organization/integrations/identities";
import { db, schema } from "@repo/shared/db";
import { encryptRecord } from "@repo/shared/db/crypto";
import type { SanitizedProviderCredential } from "@repo/shared/db/types";
import { createIntegrationSchema } from "@repo/shared/forms";
import {
  type ChannelType,
  type GenericProviderCredentials,
  PROVIDER_CONFIG,
  type ProviderType,
} from "@repo/shared/providers";
import { eq } from "drizzle-orm";
import { Elysia, status } from "elysia";
import z from "zod";
import {
  getExistingIntegrationsMap,
  getNextAvailablePriority,
  handleDefaultFlag,
} from "./utils";

export const integrationsRoutes = new Elysia({ prefix: "/integrations" })
  .use(betterAuth)
  .use(activeOrganization)
  .guard({
    activeOrganization: true,
    auth: true,
  })
  .get("/", async ({ organization }) => {
    const integrations = await db.query.providerCredential.findMany({
      where: (table, { eq }) => eq(table.organizationId, organization.id),
      columns: {
        id: true,
        organizationId: true,
        channelType: true,
        providerType: true,
        name: true,
        isDefault: true,
        priority: true,
        isActive: true,
        createdAt: true,
      },
    });

    return integrations satisfies SanitizedProviderCredential[];
  })
  .post(
    "/",
    // FIXME: Add healthcheck for credentials
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          permissions: {
            integration: ["create"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create integrations");
      }

      const config = PROVIDER_CONFIG[body.provider as ProviderType];

      if (!config) {
        return status(404, "Provider not found");
      }

      const parseResult = config.credentialsSchema.safeParse(body.credentials);

      if (!parseResult.success) {
        return status(400, "Invalid credentials");
      }

      const supportedChannels = Object.keys(config.channels) as ChannelType[];

      if (
        !body.channels.every((channelType) =>
          supportedChannels.includes(channelType as ChannelType)
        )
      ) {
        return status(400, "Invalid channels");
      }

      const channelIds = body.channels as ChannelType[];

      const rawCredentials = parseResult.data;

      const encryptedCredentialsResult = encryptRecord(
        rawCredentials.encrypted
      );

      if (encryptedCredentialsResult.error) {
        return status(500, "Failed to encrypt credentials");
      }

      const finalCredentials = {
        encrypted: encryptedCredentialsResult.data,
        unencrypted: rawCredentials.unencrypted,
      } satisfies GenericProviderCredentials;

      const validIntegrations = await db.transaction(async (tx) => {
        // Check which channels already have integrations (for auto-default logic)
        const existingIntegrationsMap = await getExistingIntegrationsMap(tx, {
          channelIds,
          organizationId: organization.id,
        });

        const integrationPromises = channelIds.map(async (channelType) => {
          const isFirstIntegrationForChannel =
            !existingIntegrationsMap[channelType];

          // Handle default flag (unset existing defaults if needed)
          const shouldBeDefault = await handleDefaultFlag(tx, {
            organizationId: organization.id,
            channelType,
            isDefault: body.isDefault,
            isFirstIntegrationForChannel,
          });

          const priority = await getNextAvailablePriority(tx, {
            organizationId: organization.id,
            channelType,
            requestedPriority: body.priority,
          });

          const [integration] = await tx
            .insert(schema.providerCredential)
            .values({
              organizationId: organization.id,
              channelType,
              providerType: body.provider as ProviderType,
              name: body.name ?? `${config.label} Integration`,
              credentials: finalCredentials,
              isDefault: shouldBeDefault,
              priority,
              isActive: body.isActive,
            })
            .returning();

          return integration;
        });

        const newIntegrations = await Promise.all(integrationPromises);
        return newIntegrations.filter(Boolean);
      });

      if (!validIntegrations || validIntegrations.length === 0) {
        return status(500, "Failed to create integration(s)");
      }

      return validIntegrations.map(
        ({ credentials: _, ...integration }) =>
          integration satisfies SanitizedProviderCredential
      );
    },
    {
      body: createIntegrationSchema,
    }
  )
  .group(
    "/byId/:id",
    {
      params: z.object({
        id: z.string(),
      }),
    },
    (app) =>
      app.use(identitiesRoutes).delete(
        "/",
        async ({ params, organization, request }) => {
          const integration = await db.query.providerCredential.findFirst({
            where: (table, { eq, and }) =>
              and(
                eq(table.id, params.id),
                eq(table.organizationId, organization.id)
              ),
          });

          if (!integration) {
            return status(404, "Integration not found");
          }

          const hasPermission = await auth.api.hasPermission({
            headers: request.headers,
            body: {
              permissions: {
                integration: ["delete"],
              },
            },
          });

          if (!hasPermission) {
            return status(
              403,
              "You do not have permission to delete integrations"
            );
          }

          await db
            .delete(schema.providerCredential)
            .where(eq(schema.providerCredential.id, params.id));

          return { success: true };
        },
        {
          params: z.object({
            id: z.string(),
          }),
        }
      )
  );
