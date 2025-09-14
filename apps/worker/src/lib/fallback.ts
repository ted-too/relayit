import { db } from "@repo/shared/db";
import type {
  ProviderCredential,
  ProviderIdentity,
} from "@repo/shared/db/types";
import type { ChannelType } from "@repo/shared/providers";
import { createGenericError, logger, type Result } from "@repo/shared/utils";
import { env } from "@/env";
import { getAttemptedIdentities } from "./message-ops";

export type FallbackCandidate = ProviderIdentity & {
  providerCredential: ProviderCredential;
};

/**
 * Finds fallback providers with the same identity identifier.
 * Implements round-robin logic to avoid providers that have already been tried.
 */
export async function findFallbackProvider(
  organizationId: string,
  channel: ChannelType,
  requiredIdentifier: string,
  messageId: string
): Promise<Result<FallbackCandidate | null>> {
  const logContext = {
    operation: "findFallbackProvider",
    organizationId,
    channel,
    requiredIdentifier,
    messageId,
  };

  // Get all attempted identities for this message
  const attemptedResult = await getAttemptedIdentities(messageId);
  if (attemptedResult.error) {
    return attemptedResult;
  }

  const attemptedIdentityIds = attemptedResult.data;

  logger.debug(
    {
      ...logContext,
      attemptedIdentityIds,
      stage: "get_attempted_identities",
    },
    `Found ${attemptedIdentityIds.length} previously attempted identities`
  );

  // Find alternative providers with the same identifier
  const identityQuery = await db.query.providerIdentity.findMany({
    where: (table, { eq, and, notInArray }) =>
      and(
        eq(table.identifier, requiredIdentifier),
        eq(table.isActive, true),
        attemptedIdentityIds.length > 0
          ? notInArray(table.id, attemptedIdentityIds)
          : undefined
      ),
    with: {
      providerCredential: true,
    },
  });

  // Filter and sort in-memory (Drizzle doesn't support nested ordering)
  const validCandidates: FallbackCandidate[] = identityQuery
    .filter(
      (identity) =>
        identity.providerCredential &&
        identity.providerCredential.organizationId === organizationId &&
        identity.providerCredential.channelType === channel &&
        identity.providerCredential.isActive
    )
    .sort(
      (a, b) => a.providerCredential.priority - b.providerCredential.priority
    );

  if (validCandidates.length === 0) {
    logger.debug(
      {
        ...logContext,
        stage: "no_fallback_found",
        totalCandidates: identityQuery.length,
        validCandidates: validCandidates.length,
      },
      "No fallback providers found with required identifier"
    );
    return { error: null, data: null };
  }

  const selectedCandidate = validCandidates[0];
  if (!selectedCandidate) {
    return { error: null, data: null };
  }

  logger.info(
    {
      ...logContext,
      stage: "fallback_selected",
      selectedProvider: selectedCandidate.providerCredential.name,
      selectedIdentity: selectedCandidate.identifier,
      totalCandidates: validCandidates.length,
    },
    `Selected fallback provider: ${selectedCandidate.providerCredential.name}`
  );

  return { error: null, data: selectedCandidate };
}

/**
 * Determines if fallback should be attempted based on round-robin limits.
 */
export async function shouldAttemptFallback(
  messageId: string
): Promise<Result<boolean>> {
  const logContext = {
    operation: "shouldAttemptFallback",
    messageId,
  };

  try {
    // Count unique providers attempted for this message
    const events = await db.query.messageEvent.findMany({
      where: (table, { eq }) => eq(table.messageId, messageId),
      with: {
        identity: {
          with: {
            providerCredential: true,
          },
        },
      },
    });

    const uniqueProviderIds = new Set(
      events.map((event) => event.identity.providerCredential.id)
    );

    const providerAttemptCount = uniqueProviderIds.size;
    const shouldAttempt =
      providerAttemptCount < env.WORKER_MAX_ROUND_ROBIN_ATTEMPTS;

    logger.debug(
      {
        ...logContext,
        providerAttemptCount,
        maxRoundRobinAttempts: env.WORKER_MAX_ROUND_ROBIN_ATTEMPTS,
        shouldAttempt,
        stage: "round_robin_check",
      },
      `Round-robin check: ${providerAttemptCount}/${env.WORKER_MAX_ROUND_ROBIN_ATTEMPTS} providers attempted`
    );

    return { error: null, data: shouldAttempt };
  } catch (error) {
    logger.error(
      {
        ...logContext,
        error,
        stage: "database_error",
      },
      "Database error checking fallback eligibility"
    );

    return {
      error: createGenericError(
        `Failed to check fallback eligibility for message ${messageId}`,
        error
      ),
      data: null,
    };
  }
}

/**
 * Determines if a retry should be attempted for the current provider.
 */
export function shouldRetry(
  attemptNumber: number,
  isRetryable: boolean
): boolean {
  return isRetryable && attemptNumber < env.WORKER_MAX_RETRY_ATTEMPTS;
}

/**
 * Calculates retry delay with exponential backoff and jitter.
 */
export function calculateRetryDelay(attemptNumber: number): number {
  const baseDelay = env.WORKER_BASE_RETRY_DELAY_MS;
  const exponentialDelay = Math.min(
    baseDelay * 2 ** (attemptNumber - 1),
    30_000 // Max 30 seconds
  );
  const jitter = Math.random() * 1000; // 0-1000ms jitter

  return exponentialDelay + jitter;
}
