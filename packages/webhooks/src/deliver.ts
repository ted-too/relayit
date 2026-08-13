import { defineJob, defineJobHandler, type WorkExecution } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import {
  webhookEndpoint,
  webhookEvent,
  webhookEventDelivery,
} from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Clock, DateTime, Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { typeid } from "typeid-js";
import {
  WebhookDeliveryRetryableError,
  WebhookDeliveryTerminalError,
} from "./errors";
import { signWebhookPayload } from "./signing";

const CLAIM_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export const webhookDeliverJob = defineJob({
  dispatch: "transactional",
  name: "webhook.deliver",
  payload: Schema.Struct({
    deliveryId: Schema.String,
  }),
  retry: {
    backoff: {
      baseDelayMs: 30_000,
      maxDelayMs: 60 * 60_000,
    },
    maxAttempts: 8,
  },
});

interface ClaimedDelivery {
  readonly attempts: number;
  readonly body: string;
  readonly claimToken: string;
  readonly deliveryId: string;
  readonly idempotencyId: string;
  readonly signingSecret: string;
  readonly url: string;
}

const dateFromMillis = (millis: number) =>
  DateTime.toDate(DateTime.makeUnsafe(millis));

const retryDelay = (execution: WorkExecution): number =>
  Math.min(
    webhookDeliverJob.retry.backoff.baseDelayMs *
      2 ** Math.max(0, execution.attempt - 1),
    webhookDeliverJob.retry.backoff.maxDelayMs
  );

const retryable = (deliveryId: string, message: string, cause?: unknown) =>
  new WebhookDeliveryRetryableError({
    cause,
    deliveryId,
    message,
  });

const claimDelivery = (deliveryId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const nowMillis = yield* Clock.currentTimeMillis;
    const now = dateFromMillis(nowMillis);

    return yield* db.transaction((transaction) =>
      Effect.gen(function* () {
        const [delivery] = yield* transaction
          .select()
          .from(webhookEventDelivery)
          .where(eq(webhookEventDelivery.id, deliveryId))
          .for("update");

        if (!delivery) {
          return yield* new WebhookDeliveryTerminalError({
            deliveryId,
            message: `Webhook Event Delivery ${deliveryId} not found`,
          });
        }
        if (
          delivery.status === "dead_letter" ||
          delivery.status === "delivered"
        ) {
          return null;
        }
        if (
          delivery.claimExpiresAt &&
          delivery.claimExpiresAt.getTime() > nowMillis
        ) {
          return null;
        }

        const [joined] = yield* transaction
          .select({
            eventCreatedAt: webhookEvent.createdAt,
            eventIdempotencyId: webhookEvent.idempotencyId,
            eventPayload: webhookEvent.payload,
            eventType: webhookEvent.type,
            signingSecret: webhookEndpoint.signingSecret,
            url: webhookEndpoint.url,
          })
          .from(webhookEventDelivery)
          .innerJoin(
            webhookEndpoint,
            eq(webhookEventDelivery.webhookEndpointId, webhookEndpoint.id)
          )
          .innerJoin(
            webhookEvent,
            eq(webhookEventDelivery.webhookEventId, webhookEvent.id)
          )
          .where(eq(webhookEventDelivery.id, deliveryId));

        if (!joined) {
          return yield* new WebhookDeliveryTerminalError({
            deliveryId,
            message: `Webhook Event Delivery ${deliveryId} is incomplete`,
          });
        }

        const claimToken = typeid("whclm").toString();
        const attempts = delivery.attempts + 1;
        yield* transaction
          .update(webhookEventDelivery)
          .set({
            attempts,
            attemptsInRun: delivery.attemptsInRun + 1,
            claimExpiresAt: dateFromMillis(nowMillis + CLAIM_TTL_MS),
            claimToken,
            lastAttemptAt: now,
            nextAttemptAt: null,
            status: "pending",
          })
          .where(eq(webhookEventDelivery.id, deliveryId));

        const body = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown)
        )({
          created_at: joined.eventCreatedAt.toISOString(),
          data: joined.eventPayload,
          type: joined.eventType,
        });

        return {
          attempts,
          body,
          claimToken,
          deliveryId,
          idempotencyId: joined.eventIdempotencyId,
          signingSecret: joined.signingSecret,
          url: joined.url,
        } satisfies ClaimedDelivery;
      })
    );
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "WebhookDeliveryTerminalError"
        ? error
        : retryable(deliveryId, "Webhook delivery could not be claimed", error)
    )
  );

const markDelivered = (delivery: ClaimedDelivery) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const now = dateFromMillis(yield* Clock.currentTimeMillis);
    yield* db
      .update(webhookEventDelivery)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        deliveredAt: now,
        lastError: null,
        nextAttemptAt: null,
        status: "delivered",
      })
      .where(
        and(
          eq(webhookEventDelivery.id, delivery.deliveryId),
          eq(webhookEventDelivery.claimToken, delivery.claimToken)
        )
      );
  }).pipe(
    Effect.mapError((error) =>
      retryable(
        delivery.deliveryId,
        "Webhook success could not be persisted",
        error
      )
    )
  );

const markFailed = (
  delivery: ClaimedDelivery,
  execution: WorkExecution,
  message: string
) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const now = yield* Clock.currentTimeMillis;
    yield* db
      .update(webhookEventDelivery)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        lastError: message,
        nextAttemptAt: dateFromMillis(now + retryDelay(execution)),
      })
      .where(
        and(
          eq(webhookEventDelivery.id, delivery.deliveryId),
          eq(webhookEventDelivery.claimToken, delivery.claimToken)
        )
      );
  }).pipe(
    Effect.mapError((error) =>
      retryable(
        delivery.deliveryId,
        "Webhook failure could not be persisted",
        error
      )
    )
  );

export const webhookDeliverHandler = defineJobHandler({
  contract: webhookDeliverJob,
  handle: ({ deliveryId }, execution) =>
    Effect.gen(function* () {
      const delivery = yield* claimDelivery(deliveryId);
      if (!delivery) {
        return;
      }

      const timestamp = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const http = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.post(delivery.url, {
        headers: {
          "content-type": "application/json",
          "webhook-id": delivery.idempotencyId,
          "webhook-signature": signWebhookPayload({
            body: delivery.body,
            idempotencyId: delivery.idempotencyId,
            secret: delivery.signingSecret,
            timestamp,
          }),
          "webhook-timestamp": String(timestamp),
        },
      }).pipe(HttpClientRequest.bodyText(delivery.body, "application/json"));
      const response = yield* http.execute(request).pipe(
        Effect.timeout(REQUEST_TIMEOUT_MS),
        Effect.mapError((error) =>
          retryable(deliveryId, "Webhook HTTP request failed", error)
        ),
        Effect.matchEffect({
          onFailure: (error) =>
            markFailed(delivery, execution, error.message).pipe(
              Effect.andThen(Effect.fail(error))
            ),
          onSuccess: Effect.succeed,
        })
      );

      if (response.status < 200 || response.status >= 300) {
        const message = `HTTP ${response.status}`;
        yield* markFailed(delivery, execution, message);
        return yield* retryable(deliveryId, message);
      }

      yield* markDelivered(delivery);
    }),
  classifyFailure: (failure) =>
    failure._tag === "WebhookDeliveryTerminalError" ? "terminal" : "retryable",
  onDeadLetter: ({ deliveryId }) =>
    Effect.gen(function* () {
      const db = yield* DB;
      yield* db
        .update(webhookEventDelivery)
        .set({
          claimExpiresAt: null,
          claimToken: null,
          nextAttemptAt: null,
          status: "dead_letter",
        })
        .where(eq(webhookEventDelivery.id, deliveryId));
    }).pipe(
      Effect.mapError((error) =>
        retryable(
          deliveryId,
          "Webhook dead-letter status could not be persisted",
          error
        )
      )
    ),
});
