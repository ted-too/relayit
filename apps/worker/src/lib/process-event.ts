import { db, queueMessage } from "@repo/shared/db";
import type { MessageEventWithRelations } from "@repo/shared/db/types";
import { logger } from "@repo/shared/utils";
import { PROVIDER_ERRORS } from "@/providers/errors";
import type { ProviderError } from "@/providers/interface";
import { PROVIDER_REGISTRY } from "@/providers/registry";
import {
  calculateRetryDelay,
  findFallbackProvider,
  shouldAttemptFallback,
  shouldRetry,
} from "./fallback";
import {
  createFallbackEvent,
  createRetryEvent,
  fetchEventDetails,
  updateEventStatus,
} from "./message-ops";

// Core event processing: provider execution → retry → fallback
export async function processMessageEvent(
  eventId: string,
  streamId: string,
  consumerGroup: string
): Promise<void> {
  const startTime = Date.now();
  let eventDetails: MessageEventWithRelations | null = null;

  const logContext: Record<string, any> = {
    eventId,
    streamId,
    consumerGroup,
    operation: "processMessageEvent",
  };

  logger.debug(logContext, "Starting event processing");

  const fetchResult = await fetchEventDetails(eventId);
  if (fetchResult.error)
    return logger.error(
      {
        ...logContext,
        error: fetchResult.error,
        stage: "fetch_event_details",
      },
      `Failed to fetch event details: ${fetchResult.error.message}`
    );

  eventDetails = fetchResult.data;

  // Enrich log context with event details
  logContext.messageId = eventDetails.messageId;
  logContext.channel = eventDetails.message.channel;
  logContext.contactId = eventDetails.message.contactId;
  logContext.attemptNumber = eventDetails.attemptNumber;
  logContext.providerType =
    eventDetails.identity.providerCredential.providerType;
  logContext.identityName = eventDetails.identity.identifier;

  // Idempotency check
  if (eventDetails.status === "sent" || eventDetails.status === "failed")
    return logger.info(
      {
        ...logContext,
        currentStatus: eventDetails.status,
        stage: "idempotency_check",
        skipped: true,
      },
      `Event already in final status '${eventDetails.status}'. Skipping.`
    );

  const updateResult = await updateEventStatus({
    dbOrTx: db,
    eventId,
    status: "processing",
  });
  if (updateResult.error)
    return logger.error(
      {
        ...logContext,
        error: updateResult.error,
        stage: "status_update",
        targetStatus: "processing",
      },
      `Failed to update event to processing: ${updateResult.error.message}`
    );

  logger.debug(
    { ...logContext, stage: "status_update", status: "processing" },
    "Event status updated to processing"
  );

  const providerType = eventDetails.identity.providerCredential.providerType;
  const channelType = eventDetails.message.channel;

  const provider = PROVIDER_REGISTRY[providerType][channelType];
  if (!provider) {
    logger.error(
      {
        ...logContext,
        providerType,
        channelType,
        stage: "provider_lookup",
      },
      "Provider not found in registry"
    );

    await updateEventStatus({
      dbOrTx: db,
      eventId,
      status: "failed",
      error: PROVIDER_ERRORS.PROVIDER_NOT_FOUND,
    });

    return;
  }

  const recipientIdentifier = eventDetails.message.contact.identifiers.find(
    (id) => id.channel === channelType
  )?.identifier;

  if (!recipientIdentifier) {
    logger.error(
      {
        ...logContext,
        channelType,
        contactId: eventDetails.message.contactId,
        stage: "recipient_lookup",
      },
      "Recipient identifier not found"
    );

    await updateEventStatus({
      dbOrTx: db,
      eventId,
      status: "failed",
      error: PROVIDER_ERRORS.RECIPIENT_NOT_FOUND,
    });

    return;
  }

  const providerStartTime = Date.now();
  logger.debug(
    {
      ...logContext,
      stage: "provider_send",
      provider: providerType,
      recipient: recipientIdentifier,
    },
    "Sending via provider"
  );

  const sendResult = await provider({
    to: recipientIdentifier,
    credentials: eventDetails.identity.providerCredential,
    payload: eventDetails.message.payload,
    identity: eventDetails.identity,
  });

  const responseTimeMs = Date.now() - providerStartTime;

  if (sendResult.error)
    return await handleSendFailure(
      eventDetails,
      sendResult.error,
      responseTimeMs
    );

  logger.info(
    {
      ...logContext,
      providerDetails: sendResult.data,
      responseTimeMs,
      totalDuration: Date.now() - startTime,
      stage: "provider_send",
      success: true,
    },
    `Message sent successfully via ${providerType}`
  );

  await updateEventStatus({
    dbOrTx: db,
    eventId,
    status: "sent",
    responseTimeMs,
  });
}

// Retry and fallback logic for failed sends
async function handleSendFailure(
  eventDetails: MessageEventWithRelations,
  error: ProviderError,
  responseTimeMs: number
): Promise<void> {
  const logContext = {
    operation: "handleSendFailure",
    eventId: eventDetails.id,
    messageId: eventDetails.messageId,
    attemptNumber: eventDetails.attemptNumber,
    retryable: error.retryable,
  };

  logger.error(
    {
      ...logContext,
      error,
      responseTimeMs,
      stage: "provider_send",
    },
    `Provider failed to send: ${error.message}`
  );

  // Update current event as failed
  await updateEventStatus({
    dbOrTx: db,
    eventId: eventDetails.id,
    status: "failed",
    responseTimeMs,
    error,
  });

  if (shouldRetry(eventDetails.attemptNumber, error.retryable)) {
    const retryDelay = calculateRetryDelay(eventDetails.attemptNumber);

    logger.info(
      {
        ...logContext,
        stage: "retry_scheduled",
        retryDelay,
        nextAttempt: eventDetails.attemptNumber + 1,
      },
      `Scheduling retry in ${retryDelay}ms`
    );

    setTimeout(async () => {
      const retryResult = await createRetryEvent(
        db,
        eventDetails,
        eventDetails.attemptNumber + 1
      );

      if (retryResult.error)
        return logger.error(
          {
            ...logContext,
            error: retryResult.error,
            stage: "create_retry_event",
          },
          "Failed to create retry event"
        );

      await queueMessage(retryResult.data.id);
    }, retryDelay);

    return;
  }

  const fallbackCheck = await shouldAttemptFallback(eventDetails.messageId);
  if (fallbackCheck.error || !fallbackCheck.data)
    return logger.warn(
      {
        ...logContext,
        stage: "fallback_check",
        reason:
          fallbackCheck.error?.message || "Max round-robin attempts reached",
      },
      "No fallback available - message permanently failed"
    );

  const fallbackResult = await findFallbackProvider(
    eventDetails.identity.providerCredential.organizationId,
    eventDetails.message.channel,
    eventDetails.identity.identifier,
    eventDetails.messageId
  );

  if (fallbackResult.error || !fallbackResult.data)
    return logger.warn(
      {
        ...logContext,
        stage: "fallback_search",
        reason:
          fallbackResult.error?.message || "No fallback providers available",
      },
      "No fallback provider found - message permanently failed"
    );

  const fallbackCandidate = fallbackResult.data;

  logger.info(
    {
      ...logContext,
      stage: "fallback_initiated",
      fallbackProvider: fallbackCandidate.providerCredential.name,
      fallbackIdentity: fallbackCandidate.identifier,
    },
    `Initiating fallback to ${fallbackCandidate.providerCredential.name}`
  );

  const fallbackEventResult = await createFallbackEvent(
    db,
    eventDetails,
    fallbackCandidate.id
  );

  if (fallbackEventResult.error)
    return logger.error(
      {
        ...logContext,
        error: fallbackEventResult.error,
        stage: "create_fallback_event",
      },
      "Failed to create fallback event"
    );

  await queueMessage(fallbackEventResult.data.id);

  logger.info(
    {
      ...logContext,
      stage: "fallback_queued",
      fallbackEventId: fallbackEventResult.data.id,
    },
    "Fallback event queued for processing"
  );
}
