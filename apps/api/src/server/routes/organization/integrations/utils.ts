import { schema, type Transaction } from "@repo/api/db";
import type { ChannelType } from "@repo/shared/providers";
import { and, eq, inArray, max } from "drizzle-orm";

/**
 * Calculates the next available priority for a channel, rounded to nearest 100
 * @param organizationId - The organization ID
 * @param channelType - The channel type
 * @param requestedPriority - Optional requested priority
 * @returns Promise<number> - The next available priority
 */
export async function getNextAvailablePriority(
  tx: Transaction,
  {
    organizationId,
    channelType,
    requestedPriority,
  }: {
    organizationId: string;
    channelType: ChannelType;
    requestedPriority?: number | null;
  }
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
      throw new Error(
        `Priority ${requestedPriority} is already taken for this channel`
      );
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
export async function handleDefaultFlag(
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

  if (!shouldBeDefault) {
    return false;
  }

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
export async function getExistingIntegrationsMap(
  tx: Transaction,
  {
    organizationId,
    channelIds,
  }: { organizationId: string; channelIds: ChannelType[] }
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

/**
 * Handles default flag logic for identities - ensures only one default per provider
 * @param providerCredentialId - The provider credential ID
 * @param isDefault - Whether this should be the default
 * @param isFirstIdentityForProvider - Whether this is the first identity for this provider
 */
export async function handleIdentityDefaultFlag(
  tx: Transaction,
  {
    providerCredentialId,
    isDefault,
    isFirstIdentityForProvider,
  }: {
    providerCredentialId: string;
    isDefault: boolean;
    isFirstIdentityForProvider: boolean;
  }
): Promise<boolean> {
  const shouldBeDefault = isDefault || isFirstIdentityForProvider;

  if (!shouldBeDefault) {
    return false;
  }

  // Unset any existing defaults for this provider
  await tx
    .update(schema.providerIdentity)
    .set({ isDefault: false })
    .where(
      and(
        eq(schema.providerIdentity.providerCredentialId, providerCredentialId),
        eq(schema.providerIdentity.isDefault, true)
      )
    );

  return true;
}
