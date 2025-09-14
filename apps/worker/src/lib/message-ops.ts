import { db, schema, type Transaction } from "@repo/shared/db";
import type {
  MessageEvent,
  MessageEventWithRelations,
} from "@repo/shared/db/types";
import { createGenericError, type Result } from "@repo/shared/utils";
import { eq } from "drizzle-orm";
import type { ProviderError } from "@/providers/interface";

export async function fetchEventDetails(
  eventId: string
): Promise<Result<MessageEventWithRelations>> {
  try {
    const eventDetails = await db.query.messageEvent.findFirst({
      where: (table, { eq }) => eq(table.id, eventId),
      with: {
        message: {
          with: {
            contact: {
              with: {
                identifiers: true,
              },
            },
          },
        },
        identity: {
          with: {
            providerCredential: true,
          },
        },
      },
    });

    if (!eventDetails) {
      return {
        error: createGenericError(`Message event ${eventId} not found`),
        data: null,
      };
    }

    return {
      error: null,
      data: eventDetails as MessageEventWithRelations,
    };
  } catch (error) {
    return {
      error: createGenericError(
        `Database error fetching event ${eventId}`,
        error
      ),
      data: null,
    };
  }
}

interface UpdateEventStatusOptions {
  dbOrTx: typeof db | Transaction;
  eventId: string;
  status: "processing" | "sent" | "failed";
  responseTimeMs?: number;
  error?: ProviderError;
}

export async function updateEventStatus({
  dbOrTx,
  eventId,
  status,
  responseTimeMs,
  error,
}: UpdateEventStatusOptions): Promise<Result<void>> {
  try {
    await dbOrTx
      .update(schema.messageEvent)
      .set({
        status,
        completedAt: new Date(),
        responseTimeMs,
        error,
        retryable: error?.retryable,
      })
      .where(eq(schema.messageEvent.id, eventId));

    return { error: null, data: undefined };
  } catch (dbError) {
    return {
      error: createGenericError(
        `Database error updating event ${eventId} to ${status}`,
        dbError
      ),
      data: null,
    };
  }
}

export async function createRetryEvent(
  dbOrTx: typeof db | Transaction,
  originalEvent: MessageEventWithRelations,
  attemptNumber: number
): Promise<Result<MessageEvent>> {
  try {
    const [retryEvent] = await dbOrTx
      .insert(schema.messageEvent)
      .values({
        messageId: originalEvent.messageId,
        status: "queued",
        attemptNumber,
        identityId: originalEvent.identityId,
      })
      .returning();

    if (!retryEvent) throw new Error("Event created but not returned");

    return { error: null, data: retryEvent };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to create retry event for message ${originalEvent.messageId}`,
        error
      ),
      data: null,
    };
  }
}

export async function createFallbackEvent(
  dbOrTx: typeof db | Transaction,
  originalEvent: MessageEventWithRelations,
  fallbackIdentityId: string
): Promise<Result<MessageEvent>> {
  try {
    const [fallbackEvent] = await dbOrTx
      .insert(schema.messageEvent)
      .values({
        messageId: originalEvent.messageId,
        status: "queued",
        attemptNumber: 1, // Reset attempt number for new provider
        identityId: fallbackIdentityId,
      })
      .returning();

    if (!fallbackEvent) throw new Error("Event created but not returned");

    return { error: null, data: fallbackEvent };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to create fallback event for message ${originalEvent.messageId}`,
        error
      ),
      data: null,
    };
  }
}

// Get all attempted provider identities for a message (for fallback exclusion)
export async function getAttemptedIdentities(
  messageId: string
): Promise<Result<string[]>> {
  try {
    const events = await db.query.messageEvent.findMany({
      where: (table, { eq }) => eq(table.messageId, messageId),
      columns: { identityId: true },
    });

    const identityIds = [...new Set(events.map((e) => e.identityId))];
    return { error: null, data: identityIds };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to get attempted identities for message ${messageId}`,
        error
      ),
      data: null,
    };
  }
}
