import {
	type MessageWithRelations,
	acknowledgeMessage,
	db,
	schema as dbSchema,
	fetchMessageDetails,
	logMessageEvent,
	updateMessageStatus,
} from "@repo/db";
import type {
	ProjectProviderConfig,
	ProviderCredentials,
	SendMessagePayload,
} from "@repo/shared";
import { getProvider } from "@repo/worker/providers"; // Adjusted path
import { eq } from "drizzle-orm"; // Required for the direct status check query

/**
 * Handles the processing of a single message from the queue.
 *
 * @param internalMessageId The internal ID (UUID) of the message.
 * @param messageStreamId The ID of the message in the Redis stream.
 * @param consumerGroupName The name of the Redis consumer group.
 */
export async function handleMessage(
	internalMessageId: string,
	messageStreamId: string,
	consumerGroupName: string,
): Promise<void> {
	let messageDetails: MessageWithRelations | null = null;

	try {
		// Attempt to fetch message details first
		const fetchResult = await fetchMessageDetails(internalMessageId);
		if (fetchResult.error) {
			console.error(
				`[Worker] Failed to fetch message details for ID ${internalMessageId}: ${fetchResult.error.message}`,
				fetchResult.error.details,
			);
			return;
		}

		messageDetails = fetchResult.data;

		if (!messageDetails) {
			console.error(
				`[Worker] No message found for ID ${internalMessageId}. Acknowledging and skipping.`,
			);
			return; // Message will be ack'd in finally.
		}

		// --- Start Transaction for status updates and event logging ---
		await db.transaction(async (tx) => {
			// --- Start: Idempotency Check ---
			const currentMessageState = await tx.query.message.findFirst({
				columns: { status: true },
				where: eq(dbSchema.message.id, internalMessageId),
			});

			if (
				currentMessageState?.status === "sent" ||
				currentMessageState?.status === "delivered"
			) {
				console.log(
					`[Worker] Message ${internalMessageId} already in status '${currentMessageState.status}'. Skipping processing, will ensure acknowledgment.`,
				);
				return; // Exit transaction; finally block will acknowledge.
			}
			// --- End: Idempotency Check ---

			// --- Start: Malformed Data Checks ---
			if (!messageDetails?.projectProviderAssociation) {
				const reason = "Missing projectProviderAssociation for message.";
				console.warn(
					`[Worker] Malformed message ${internalMessageId}: ${reason}`,
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return; // Exit transaction, message will be acked in finally
			}
			if (!messageDetails.projectProviderAssociation.providerCredential) {
				const reason =
					"Missing providerCredential in projectProviderAssociation.";
				console.warn(
					`[Worker] Malformed message ${internalMessageId}: ${reason}`,
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return;
			}
			if (!messageDetails.projectProviderAssociation.config) {
				const reason = "Missing config in projectProviderAssociation.";
				console.warn(
					`[Worker] Malformed message ${internalMessageId}: ${reason}`,
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return;
			}
			if (!messageDetails.payload || !messageDetails.recipient) {
				const reason = "Missing payload or recipient for message.";
				console.warn(
					`[Worker] Malformed message ${internalMessageId}: ${reason}`,
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return;
			}
			// --- End: Malformed Data Checks ---

			const processingStatusUpdate = await updateMessageStatus(
				tx,
				internalMessageId,
				"processing",
			);
			if (processingStatusUpdate.error) {
				console.error(
					`[Worker] DB Error updating message ${internalMessageId} to 'processing': ${processingStatusUpdate.error.message}`,
					processingStatusUpdate.error.details,
				);
				throw new Error("Failed to update status to processing");
			}
			await logMessageEvent(tx, internalMessageId, "processing");

			// Get the provider
			// Type assertion for channel, assuming it's valid if message exists
			const provider = getProvider(messageDetails.channel as any);

			// Prepare credentials and payload
			const encryptedCredentials = messageDetails.projectProviderAssociation
				.providerCredential.credentials as ProviderCredentials;
			const providerConfig = messageDetails.projectProviderAssociation
				.config as ProjectProviderConfig;
			const messagePayload = messageDetails.payload as SendMessagePayload;
			const recipient = messageDetails.recipient;

			// Send via provider
			const sendResult = await provider.send(
				encryptedCredentials,
				messagePayload,
				providerConfig,
				recipient,
			);

			if (sendResult.error || !sendResult.data?.success) {
				const reason =
					sendResult.error?.message ||
					sendResult.data?.details?.toString() ||
					"Provider send failed without details";
				console.error(
					`[Worker] Provider failed to send message ${internalMessageId}: ${reason}`,
					sendResult.error?.details,
				);
				await updateMessageStatus(tx, internalMessageId, "failed", reason);
				await logMessageEvent(tx, internalMessageId, "failed", {
					reason,
					providerDetails: sendResult.data?.details,
					providerError: sendResult.error,
				});
			} else {
				await updateMessageStatus(tx, internalMessageId, "sent");
				await logMessageEvent(tx, internalMessageId, "sent", {
					providerDetails: sendResult.data.details,
				});
				console.log(
					`[Worker] Message ${internalMessageId} sent successfully via ${messageDetails.channel}.`,
				);
			}
		}); // --- End Transaction ---
	} catch (error: any) {
		console.error(
			`[Worker] Unhandled error processing message ID ${internalMessageId}: ${error.message}`,
			{ stack: error.stack },
		);
		// If an error occurred after fetching details, try to mark as failed
		if (messageDetails) {
			try {
				// Use a new transaction or a non-transactional update for this fallback
				await db.transaction(async (txFallback) => {
					await updateMessageStatus(
						txFallback,
						internalMessageId,
						"failed",
						error.message || "Unhandled processing error",
					);
					await logMessageEvent(txFallback, internalMessageId, "failed", {
						error: error.message,
						stack: error.stack,
					});
				});
			} catch (dbError: any) {
				console.error(
					`[Worker] CRITICAL: Failed to update message ${internalMessageId} to 'failed' status after unhandled error: ${dbError.message}`,
				);
			}
		}
	} finally {
		// Always acknowledge the message in Redis
		const ackResult = await acknowledgeMessage(
			messageStreamId,
			consumerGroupName,
		);
		if (ackResult.error) {
			console.error(
				`[Worker] CRITICAL: Failed to acknowledge message stream ID ${messageStreamId} in group ${consumerGroupName}: ${ackResult.error.message}`,
				ackResult.error.details,
			);
		} else {
			console.log(
				`[Worker] Message stream ID ${messageStreamId} acknowledged in group ${consumerGroupName}. Ack count: ${ackResult.data}`,
			);
		}
	}
}
