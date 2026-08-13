import { Jobs } from "@repo/jobs";
import type { DatabaseTransaction } from "@repo/persistence/db/effect";
import {
  webhookEndpoint,
  webhookEvent,
  webhookEventDelivery,
} from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Clock, DateTime, Effect } from "effect";
import { typeid } from "typeid-js";
import { webhookDeliverJob } from "./deliver";
import { WebhookEmissionError } from "./errors";
import type { WebhookEvent } from "./events";

export interface WebhookEndpointMatchInput {
  readonly enabled: boolean;
  readonly eventTypes: readonly string[];
  readonly messageTags?: Readonly<Record<string, string>> | null;
  readonly tagFilter?: Readonly<Record<string, string>> | null;
  readonly type: string;
}

export const endpointMatches = ({
  enabled,
  eventTypes,
  messageTags,
  tagFilter,
  type,
}: WebhookEndpointMatchInput): boolean => {
  if (!enabled) {
    return false;
  }
  if (!eventTypes.includes(type)) {
    return false;
  }
  if (!tagFilter || Object.keys(tagFilter).length === 0) {
    return true;
  }

  const tags = messageTags ?? {};
  return Object.entries(tagFilter).every(([key, value]) => tags[key] === value);
};

export interface EmitWebhookEventInput {
  readonly event: WebhookEvent;
  readonly idempotencyId?: string;
  readonly messageTags?: Readonly<Record<string, string>> | null;
  readonly organizationId: string;
}

export interface EmittedWebhookEvent {
  readonly deliveryCount: number;
  readonly eventId: string;
}

const emissionError =
  (stage: WebhookEmissionError["stage"]) => (cause: unknown) =>
    new WebhookEmissionError({ cause, stage });

export const emitWebhookEvent = (
  transaction: DatabaseTransaction,
  input: EmitWebhookEventInput
): Effect.Effect<EmittedWebhookEvent | null, WebhookEmissionError, Jobs> =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    const endpoints = yield* transaction
      .select()
      .from(webhookEndpoint)
      .where(
        and(
          eq(webhookEndpoint.organizationId, input.organizationId),
          eq(webhookEndpoint.enabled, true)
        )
      )
      .pipe(Effect.mapError(emissionError("endpoints")));
    const matching = endpoints.filter((endpoint) =>
      endpointMatches({
        enabled: endpoint.enabled,
        eventTypes: endpoint.eventTypes,
        messageTags: input.messageTags,
        tagFilter: endpoint.tagFilter,
        type: input.event.type,
      })
    );

    if (matching.length === 0) {
      return null;
    }

    const [event] = yield* transaction
      .insert(webhookEvent)
      .values({
        idempotencyId: input.idempotencyId ?? typeid("whid").toString(),
        organizationId: input.organizationId,
        payload: input.event.data,
        type: input.event.type,
      })
      .returning({ id: webhookEvent.id })
      .pipe(Effect.mapError(emissionError("event")));

    if (!event) {
      return yield* new WebhookEmissionError({
        cause: new Error("Webhook Event insert returned no record"),
        stage: "event",
      });
    }

    const now = DateTime.toDate(
      DateTime.makeUnsafe(yield* Clock.currentTimeMillis)
    );
    yield* Effect.forEach(
      matching,
      (endpoint) =>
        Effect.gen(function* () {
          const [delivery] = yield* transaction
            .insert(webhookEventDelivery)
            .values({
              nextAttemptAt: now,
              status: "pending",
              webhookEndpointId: endpoint.id,
              webhookEventId: event.id,
            })
            .returning({ id: webhookEventDelivery.id })
            .pipe(Effect.mapError(emissionError("deliveries")));

          if (!delivery) {
            return yield* new WebhookEmissionError({
              cause: new Error(
                "Webhook Event Delivery insert returned no record"
              ),
              stage: "deliveries",
            });
          }

          yield* jobs
            .enqueue(
              webhookDeliverJob,
              { deliveryId: delivery.id },
              transaction
            )
            .pipe(Effect.mapError(emissionError("jobs")));
        }),
      { concurrency: 1, discard: true }
    );

    return {
      deliveryCount: matching.length,
      eventId: event.id,
    };
  });
