import { Jobs } from "@repo/jobs";
import type { DatabaseTransaction } from "@repo/persistence/db/effect";
import {
  webhookEndpoint,
  webhookEventDelivery,
} from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Clock, DateTime, Effect } from "effect";
import { webhookDeliverJob } from "./deliver";
import { WebhookManagementError } from "./errors";
import { generateWebhookSigningSecret } from "./signing";

const DUAL_SECRET_WINDOW_MS = 24 * 60 * 60 * 1000;

const operationFailed = (message: string, cause: unknown) =>
  new WebhookManagementError({
    cause,
    code: "operation_failed",
    message,
  });

export interface SetWebhookEndpointEnabledInput {
  readonly enabled: boolean;
  readonly endpointId: string;
  readonly organizationId: string;
}

export const setWebhookEndpointEnabled = (
  transaction: DatabaseTransaction,
  input: SetWebhookEndpointEnabledInput
): Effect.Effect<void, WebhookManagementError> =>
  Effect.gen(function* () {
    const [endpoint] = yield* transaction
      .update(webhookEndpoint)
      .set({ enabled: input.enabled })
      .where(
        and(
          eq(webhookEndpoint.id, input.endpointId),
          eq(webhookEndpoint.organizationId, input.organizationId)
        )
      )
      .returning({ id: webhookEndpoint.id })
      .pipe(
        Effect.mapError((cause) =>
          operationFailed("Webhook Endpoint could not be updated", cause)
        )
      );

    if (!endpoint) {
      return yield* new WebhookManagementError({
        code: "endpoint_not_found",
        message: "Webhook Endpoint not found",
      });
    }
  });

export interface ReplayWebhookDeliveryInput {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly organizationId: string;
}

export const replayWebhookDelivery = (
  transaction: DatabaseTransaction,
  input: ReplayWebhookDeliveryInput
): Effect.Effect<
  { readonly status: "pending" },
  WebhookManagementError,
  Jobs
> =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    const [record] = yield* transaction
      .select({
        deliveryId: webhookEventDelivery.id,
        deliveryStatus: webhookEventDelivery.status,
        enabled: webhookEndpoint.enabled,
        replayCount: webhookEventDelivery.replayCount,
      })
      .from(webhookEventDelivery)
      .innerJoin(
        webhookEndpoint,
        eq(webhookEventDelivery.webhookEndpointId, webhookEndpoint.id)
      )
      .where(
        and(
          eq(webhookEventDelivery.id, input.deliveryId),
          eq(webhookEndpoint.id, input.endpointId),
          eq(webhookEndpoint.organizationId, input.organizationId)
        )
      )
      .pipe(
        Effect.mapError((cause) =>
          operationFailed("Webhook Event Delivery could not be loaded", cause)
        )
      );

    if (!record) {
      return yield* new WebhookManagementError({
        code: "delivery_not_found",
        message: "Webhook Event Delivery not found",
      });
    }
    if (record.deliveryStatus !== "dead_letter") {
      return yield* new WebhookManagementError({
        code: "invalid_replay_state",
        message: "Only dead-lettered Webhook Event Deliveries may be replayed",
      });
    }
    if (!record.enabled) {
      return yield* new WebhookManagementError({
        code: "endpoint_paused",
        message: "A paused Webhook Endpoint cannot replay Deliveries",
      });
    }

    yield* transaction
      .update(webhookEventDelivery)
      .set({
        attemptsInRun: 0,
        claimExpiresAt: null,
        claimToken: null,
        lastError: null,
        nextAttemptAt: null,
        replayCount: record.replayCount + 1,
        status: "pending",
      })
      .where(eq(webhookEventDelivery.id, record.deliveryId))
      .pipe(
        Effect.mapError((cause) =>
          operationFailed("Webhook Event Delivery could not be replayed", cause)
        )
      );
    yield* jobs
      .enqueue(
        webhookDeliverJob,
        { deliveryId: record.deliveryId },
        transaction
      )
      .pipe(
        Effect.mapError((cause) =>
          operationFailed("Webhook replay could not be scheduled", cause)
        )
      );

    return { status: "pending" as const };
  });

export interface RotateWebhookSigningSecretInput {
  readonly endpointId: string;
  readonly organizationId: string;
}

export const rotateWebhookSigningSecret = (
  transaction: DatabaseTransaction,
  input: RotateWebhookSigningSecretInput
): Effect.Effect<string, WebhookManagementError> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const signingSecret = generateWebhookSigningSecret();
    const [endpoint] = yield* transaction
      .select({ signingSecret: webhookEndpoint.signingSecret })
      .from(webhookEndpoint)
      .where(
        and(
          eq(webhookEndpoint.id, input.endpointId),
          eq(webhookEndpoint.organizationId, input.organizationId)
        )
      );
    if (!endpoint) {
      return yield* new WebhookManagementError({
        code: "endpoint_not_found",
        message: "Webhook Endpoint not found",
      });
    }

    yield* transaction
      .update(webhookEndpoint)
      .set({
        previousSecretExpiresAt: DateTime.toDate(
          DateTime.makeUnsafe(now + DUAL_SECRET_WINDOW_MS)
        ),
        previousSigningSecret: endpoint.signingSecret,
        signingSecret,
      })
      .where(eq(webhookEndpoint.id, input.endpointId));

    return signingSecret;
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "WebhookManagementError"
        ? error
        : operationFailed("Webhook signing secret could not be rotated", error)
    )
  );

export const clearPreviousWebhookSigningSecret = (
  transaction: DatabaseTransaction,
  input: RotateWebhookSigningSecretInput
): Effect.Effect<void, WebhookManagementError> =>
  Effect.gen(function* () {
    const [endpoint] = yield* transaction
      .update(webhookEndpoint)
      .set({
        previousSecretExpiresAt: null,
        previousSigningSecret: null,
      })
      .where(
        and(
          eq(webhookEndpoint.id, input.endpointId),
          eq(webhookEndpoint.organizationId, input.organizationId)
        )
      )
      .returning({ id: webhookEndpoint.id });
    if (!endpoint) {
      return yield* new WebhookManagementError({
        code: "endpoint_not_found",
        message: "Webhook Endpoint not found",
      });
    }
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "WebhookManagementError"
        ? error
        : operationFailed(
            "Previous Webhook signing secret could not be cleared",
            error
          )
    )
  );
