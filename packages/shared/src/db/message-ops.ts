import {
  createGenericError,
  type MessageStatus,
  type Result,
} from "@repo/shared";
import { eq } from "drizzle-orm";
import { db, schema } from ".";

export type Transaction = Parameters<typeof db.transaction>[0] extends (
  tx: infer T
) => any
  ? T
  : never;

// Define the type for message with relations included
// Adjust based on your actual schema and relation names in Drizzle
export type MessageWithRelations = typeof schema.message.$inferSelect & {
  projectProviderAssociation:
    | (typeof schema.projectProviderAssociation.$inferSelect & {
        providerCredential:
          | typeof schema.providerCredential.$inferSelect
          | null;
      })
    | null;
};

/**
 * Fetches the full message details including related provider credentials.
 *
 * @param messageId The Id of the message to fetch.
 * @returns A Result object containing the message details with relations, or an error.
 */
export async function fetchMessageDetails(
  messageId: string
): Promise<Result<MessageWithRelations>> {
  // TODO: Add a check to see the status of the provider so we can choose a different one if available and primary failed
  try {
    const messageDetails = await db.query.message.findFirst({
      where: eq(schema.message.id, messageId),
    });

    if (!messageDetails) {
      return {
        error: createGenericError(`Message ${messageId} not found`),
        data: null,
      };
    }

    const projectProviderAssociations = (
      await db.query.projectProviderAssociation.findMany({
        where: eq(
          schema.projectProviderAssociation.appId,
          messageDetails.appId
        ),
        with: {
          providerCredential: true,
        },
      })
    )
      .filter(
        (ppa) =>
          ppa.providerCredential.channelType === messageDetails.channel &&
          ppa.providerCredential.providerType === messageDetails.providerType
      )
      .sort((a, b) => a.priority - b.priority);

    const projectProviderAssociation = projectProviderAssociations?.[0] ?? null;
    if (!projectProviderAssociation) {
      return {
        error: createGenericError(
          `No project provider association found for message ${messageId}`
        ),
        data: null,
      };
    }

    return {
      error: null,
      data: {
        ...messageDetails,
        projectProviderAssociation,
      },
    };
  } catch (error) {
    const errorMessage = `Database error fetching message ${messageId}`;
    return {
      error: createGenericError(errorMessage, error),
      data: null,
    };
  }
}

/**
 * Updates the status of a message.
 *
 * @param tx The database instance or a transaction object.
 * @param messageId The Id of the message to update.
 * @param status The new status for the message.
 * @param reason Optional reason for the status change (e.g., error message).
 * @returns A Result object indicating success or failure.
 */
export async function updateMessageStatus(
  tx: Transaction | typeof db,
  messageId: string,
  status: MessageStatus,
  reason?: string
): Promise<Result<void>> {
  try {
    await tx
      .update(schema.message)
      .set({
        status,
        statusReason: reason ?? null,
        lastStatusAt: new Date(),
        updatedAt: new Date(), // Also update the general updated timestamp
      })
      .where(eq(schema.message.id, messageId));
    // Return success result
    return { error: null, data: undefined };
  } catch (error) {
    const errorMessage = `Database error updating message status for ${messageId} to ${status}`;
    return {
      error: createGenericError(errorMessage, error),
      data: null,
    };
  }
}

/**
 * Logs an event related to a message's lifecycle.
 *
 * @param tx The database instance or a transaction object.
 * @param messageId The Id of the related message.
 * @param status The status being logged (can align with message status or be more specific).
 * @param details Optional JSON object containing additional context about the event.
 * @returns A Result object indicating success or failure.
 */
export async function logMessageEvent(
  tx: Transaction | typeof db,
  messageId: string,
  status: MessageStatus,
  details?: any
): Promise<Result<void>> {
  try {
    await tx.insert(schema.messageEvent).values({
      messageId,
      status,
      details: details ?? null,
    });
    // Return success result
    return { error: null, data: undefined };
  } catch (error) {
    const errorMessage = `Database error logging event for message ${messageId}, status ${status}`;
    return {
      error: createGenericError(errorMessage, error),
      data: null,
    };
  }
}
