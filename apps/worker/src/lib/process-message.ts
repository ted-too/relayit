import {
	acknowledgeMessage,
	db,
	schema as dbSchema,
	fetchMessageDetails,
	logMessageEvent,
	type MessageWithRelations,
	updateMessageStatus,
} from "@repo/db";
import type {
	ProjectProviderConfig,
	ProviderCredentials,
	SendMessagePayload,
} from "@repo/shared";
import { logger } from "@repo/worker/lib/utils";
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
	consumerGroupName: string
): Promise<void> {
	const startTime = Date.now();
	let messageDetails: MessageWithRelations | null = null;

	// Create structured context for this message processing operation
	const logContext: Record<string, any> = {
		messageId: internalMessageId,
		streamId: messageStreamId,
		consumerGroup: consumerGroupName,
		operation: "handleMessage",
	};

	logger.debug(logContext, "Starting message processing");

	try {
		// Attempt to fetch message details first
		const fetchResult = await fetchMessageDetails(internalMessageId);
		if (fetchResult.error) {
			logger.error(
				{
					...logContext,
					error: fetchResult.error,
					details: fetchResult.error.details,
					stage: "fetch_message_details",
				},
				`Failed to fetch message details: ${fetchResult.error.message}`
			);
			return;
		}

		messageDetails = fetchResult.data;

		if (!messageDetails) {
			logger.error(
				{ ...logContext, stage: "fetch_message_details" },
				"No message found in database. Acknowledging and skipping."
			);
			return; // Message will be ack'd in finally.
		}

		// Enrich log context with message details
		logContext.channel = messageDetails.channel;
		logContext.recipient = messageDetails.recipient;
		logContext.projectId = messageDetails.projectId;
		logContext.apiKeyId = messageDetails.apiKeyId;

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
				logger.info(
					{
						...logContext,
						currentStatus: currentMessageState.status,
						stage: "idempotency_check",
						skipped: true,
					},
					`Message already in final status '${currentMessageState.status}'. Skipping processing.`
				);
				return; // Exit transaction; finally block will acknowledge.
			}
			// --- End: Idempotency Check ---

			// --- Start: Malformed Data Checks ---
			if (!messageDetails?.projectProviderAssociation) {
				const reason = "Missing projectProviderAssociation for message.";
				logger.warn(
					{
						...logContext,
						reason,
						stage: "validation",
						status: "malformed",
					},
					`Malformed message detected: ${reason}`
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return;
			}
			if (!messageDetails.projectProviderAssociation.providerCredential) {
				const reason =
					"Missing providerCredential in projectProviderAssociation.";
				logger.warn(
					{
						...logContext,
						reason,
						stage: "validation",
						status: "malformed",
					},
					`Malformed message detected: ${reason}`
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return;
			}
			if (!messageDetails.projectProviderAssociation.config) {
				const reason = "Missing config in projectProviderAssociation.";
				logger.warn(
					{
						...logContext,
						reason,
						stage: "validation",
						status: "malformed",
					},
					`Malformed message detected: ${reason}`
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return;
			}
			if (!(messageDetails.payload && messageDetails.recipient)) {
				const reason = "Missing payload or recipient for message.";
				logger.warn(
					{
						...logContext,
						reason,
						stage: "validation",
						status: "malformed",
					},
					`Malformed message detected: ${reason}`
				);
				await updateMessageStatus(tx, internalMessageId, "malformed", reason);
				await logMessageEvent(tx, internalMessageId, "malformed", { reason });
				return;
			}
			// --- End: Malformed Data Checks ---

			const processingStatusUpdate = await updateMessageStatus(
				tx,
				internalMessageId,
				"processing"
			);
			if (processingStatusUpdate.error) {
				logger.error(
					{
						...logContext,
						error: processingStatusUpdate.error,
						details: processingStatusUpdate.error.details,
						stage: "status_update",
						targetStatus: "processing",
					},
					`DB Error updating message to 'processing' status: ${processingStatusUpdate.error.message}`
				);
				throw new Error("Failed to update status to processing");
			}
			await logMessageEvent(tx, internalMessageId, "processing");

			logger.debug(
				{ ...logContext, stage: "status_update", status: "processing" },
				"Message status updated to processing"
			);

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

			logger.debug(
				{
					...logContext,
					stage: "provider_send",
					provider: messageDetails.channel,
					payloadType: messagePayload.type,
				},
				"Sending message via provider"
			);

			// Send via provider
			const providerStartTime = Date.now();
			const sendResult = await provider.send(
				encryptedCredentials,
				messagePayload,
				providerConfig,
				recipient
			);
			const providerDuration = Date.now() - providerStartTime;

			if (sendResult.error || !sendResult.data?.success) {
				const reason =
					sendResult.error?.message ||
					sendResult.data?.details?.toString() ||
					"Provider send failed without details";

				logger.error(
					{
						...logContext,
						error: sendResult.error,
						details: sendResult.error?.details,
						reason,
						providerDuration,
						stage: "provider_send",
						success: false,
					},
					`Provider failed to send message: ${reason}`
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

				const totalDuration = Date.now() - startTime;
				logger.info(
					{
						...logContext,
						providerDetails: sendResult.data.details,
						providerDuration,
						totalDuration,
						stage: "provider_send",
						success: true,
						status: "sent",
					},
					`Message sent successfully via ${messageDetails.channel}`
				);
			}
		}); // --- End Transaction ---
	} catch (error: any) {
		const totalDuration = Date.now() - startTime;

		logger.error(
			{
				...logContext,
				error,
				stack: error.stack,
				totalDuration,
				stage: "unhandled_error",
				hasMessageDetails: !!messageDetails,
			},
			`Unhandled error processing message: ${error.message}`
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
						error.message || "Unhandled processing error"
					);
					await logMessageEvent(txFallback, internalMessageId, "failed", {
						error: error.message,
						stack: error.stack,
					});
				});

				logger.debug(
					{ ...logContext, stage: "error_recovery" },
					"Message marked as failed after unhandled error"
				);
			} catch (dbError: any) {
				logger.error(
					{
						...logContext,
						error: dbError,
						originalError: error,
						stage: "error_recovery",
					},
					`CRITICAL: Failed to update message to 'failed' status after unhandled error: ${dbError.message}`
				);
			}
		}
	} finally {
		// Always acknowledge the message in Redis
		const ackStartTime = Date.now();
		const ackResult = await acknowledgeMessage(
			messageStreamId,
			consumerGroupName
		);
		const ackDuration = Date.now() - ackStartTime;
		const totalDuration = Date.now() - startTime;

		if (ackResult.error) {
			logger.error(
				{
					...logContext,
					error: ackResult.error,
					details: ackResult.error.details,
					ackDuration,
					totalDuration,
					stage: "acknowledgment",
				},
				`CRITICAL: Failed to acknowledge message stream: ${ackResult.error.message}`
			);
		} else {
			logger.debug(
				{
					...logContext,
					ackCount: ackResult.data,
					ackDuration,
					totalDuration,
					stage: "acknowledgment",
				},
				"Message acknowledged successfully"
			);
		}
	}
}
