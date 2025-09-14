import { db, schema, type Transaction } from "@repo/shared/db";
import { encryptRecord } from "@repo/shared/db/crypto";
import type { SanitizedProviderCredential } from "@repo/shared/db/types";
import { createIntegrationSchema } from "@repo/shared/forms";
import {
  type ChannelType,
  type GenericProviderCredentials,
  PROVIDER_CONFIG,
  type ProviderType,
} from "@repo/shared/providers";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, max } from "drizzle-orm";
import z from "zod";
import { auth } from "@/lib/auth";
import { authdOrganizationProcedure, router } from ".";

/**
 * Calculates the next available priority for a channel, rounded to nearest 100
 * @param organizationId - The organization ID
 * @param channelType - The channel type
 * @param requestedPriority - Optional requested priority
 * @returns Promise<number> - The next available priority
 */
async function getNextAvailablePriority(
  tx: Transaction,
  organizationId: string,
  channelType: ChannelType,
  requestedPriority?: number | null
): Promise<number> {
  if (requestedPriority !== null && requestedPriority !== undefined) {
    // Check if requested priority is available
    const existing = await tx.query.providerCredential.findFirst({
      where: and(
        eq(schema.providerCredential.organizationId, organizationId),
        eq(schema.providerCredential.channelType, channelType as ChannelType),
        eq(schema.providerCredential.priority, requestedPriority)
      ),
    });

    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Priority ${requestedPriority} is already taken for this channel`,
      });
    }

    return requestedPriority;
  }

  // Find the highest priority and add 100 (rounded to nearest 100)
  const result = await tx
    .select({ maxPriority: max(schema.providerCredential.priority) })
    .from(schema.providerCredential)
    .where(
      and(
        eq(schema.providerCredential.organizationId, organizationId),
        eq(schema.providerCredential.channelType, channelType)
      )
    );

  const maxPriority = result[0]?.maxPriority ?? 0;
  const nextPriority = Math.ceil((maxPriority + 100) / 100) * 100;

  return nextPriority;
}

/**
 * Handles default flag logic - ensures only one default per channel
 * @param tx - The database transaction
 * @param params - Configuration object
 */
async function handleDefaultFlag(
  tx: Transaction,
  {
    organizationId,
    channelType,
    isDefault,
    isFirstIntegrationForChannel,
  }: {
    organizationId: string;
    channelType: ChannelType;
    isDefault: boolean;
    isFirstIntegrationForChannel: boolean;
  }
): Promise<boolean> {
  // If this is the first integration for the channel, make it default regardless
  const shouldBeDefault = isDefault || isFirstIntegrationForChannel;

  if (!shouldBeDefault) return false;

  // Unset any existing defaults for this channel
  await tx
    .update(schema.providerCredential)
    .set({ isDefault: false })
    .where(
      and(
        eq(schema.providerCredential.organizationId, organizationId),
        eq(schema.providerCredential.channelType, channelType),
        eq(schema.providerCredential.isDefault, true)
      )
    );

  return true;
}

/**
 * Checks if there are existing integrations for each channel
 * @param tx - The database transaction
 * @param organizationId - The organization ID
 * @param channelIds - Array of channel IDs to check
 * @returns Promise<Record<string, boolean>> - Map of channelId -> hasExistingIntegrations
 */
async function getExistingIntegrationsMap(
  tx: Transaction,
  organizationId: string,
  channelIds: ChannelType[]
): Promise<Record<string, boolean>> {
  const existingIntegrations = await tx.query.providerCredential.findMany({
    where: and(
      eq(schema.providerCredential.organizationId, organizationId),
      inArray(schema.providerCredential.channelType, channelIds)
    ),
    columns: {
      channelType: true,
    },
  });

  const existingChannels = new Set(
    existingIntegrations.map((i) => i.channelType)
  );

  return channelIds.reduce(
    (acc, channelId) => {
      acc[channelId] = existingChannels.has(channelId);
      return acc;
    },
    {} as Record<string, boolean>
  );
}

export const integrationsRouter = router({
  list: authdOrganizationProcedure.query(
    async ({ ctx }): Promise<SanitizedProviderCredential[]> => {
      const integrations = await db.query.providerCredential.findMany({
        where: (table, { eq }) =>
          eq(table.organizationId, ctx.session.activeOrganization.id),
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

      return integrations;
    }
  ),
  // FIXME: Add healthcheck for credentials
  create: authdOrganizationProcedure
    .input(createIntegrationSchema)
    .mutation(async ({ ctx, input }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: ctx.req.headers,
        body: {
          permissions: {
            integration: ["create"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to create integrations",
        });
      }

      const config = PROVIDER_CONFIG[input.provider as ProviderType];

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Provider not found",
        });
      }

      const parseResult = config.credentialsSchema.safeParse(input.credentials);

      if (!parseResult.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid credentials",
        });
      }

      // Validate channel types are supported by this provider
      const supportedChannels = Object.keys(config.channels) as ChannelType[];

      if (
        !input.channels.every((channelType) =>
          supportedChannels.includes(channelType as ChannelType)
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid channel types, available: ${supportedChannels.join(", ")}`,
        });
      }

      const channelTypes = input.channels as ChannelType[];

      const rawCredentials = parseResult.data;

      const encryptedCredentialsResult = encryptRecord(
        rawCredentials.encrypted
      );

      if (encryptedCredentialsResult.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to encrypt credentials",
        });
      }

      const finalCredentials = {
        encrypted: encryptedCredentialsResult.data,
        unencrypted: rawCredentials.unencrypted,
      } satisfies GenericProviderCredentials;

      // Execute all operations in a database transaction
      const validIntegrations = await db.transaction(async (tx) => {
        // Check which channels already have integrations (for auto-default logic)
        const existingIntegrationsMap = await getExistingIntegrationsMap(
          tx,
          ctx.session.activeOrganization.id,
          channelTypes
        );

        // Process all channels in parallel for better performance
        const integrationPromises = channelTypes.map(async (channelType) => {
          const isFirstIntegrationForChannel =
            !existingIntegrationsMap[channelType];

          // Handle default flag (unset existing defaults if needed)
          const shouldBeDefault = await handleDefaultFlag(tx, {
            organizationId: ctx.session.activeOrganization.id,
            channelType,
            isDefault: input.isDefault,
            isFirstIntegrationForChannel,
          });

          // Get the next available priority
          const priority = await getNextAvailablePriority(
            tx,
            ctx.session.activeOrganization.id,
            channelType,
            input.priority
          );

          // Insert the integration
          const [integration] = await tx
            .insert(schema.providerCredential)
            .values({
              organizationId: ctx.session.activeOrganization.id,
              channelType,
              providerType: input.provider as ProviderType,
              name: input.name ?? `${config.label} Integration`,
              credentials: finalCredentials,
              isDefault: shouldBeDefault,
              priority,
              isActive: input.isActive,
            })
            .returning();

          return integration;
        });

        // Wait for all integrations to be created
        const newIntegrations = await Promise.all(integrationPromises);
        return newIntegrations.filter(Boolean);
      });

      if (!validIntegrations || validIntegrations.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create integration(s)",
        });
      }

      return validIntegrations.map(
        ({ credentials: _, ...integration }) => integration
      );
    }),
  delete: authdOrganizationProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx: { session, req }, input }) => {
      const integration = await db.query.providerCredential.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, input.id),
            eq(table.organizationId, session.activeOrganization.id)
          ),
      });

      if (!integration) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Integration not found or not associated with this organization",
        });
      }

      const hasPermission = await auth.api.hasPermission({
        headers: req.headers,
        body: {
          permissions: {
            integration: ["delete"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to delete integrations",
        });
      }

      await db
        .delete(schema.providerCredential)
        .where(eq(schema.providerCredential.id, input.id));

      return { success: true };
    }),
});
