import { Schema } from "effect";
import { defineWebhookEvent, type WebhookEventInput } from "./definition";

const defineDeliveryOutcome = <
  const Kind extends
    | "accepted"
    | "bounced"
    | "clicked"
    | "complained"
    | "delivered"
    | "delivery_delayed"
    | "opened",
>(
  kind: Kind
) =>
  defineWebhookEvent({
    payload: Schema.Struct({
      delivery_id: Schema.String,
      kind: Schema.Literal(kind),
      message_id: Schema.String,
      provider_message_id: Schema.String,
      recipients: Schema.Array(Schema.String),
    }),
    type: `delivery.${kind}` as const,
  });

export const deliveryAccepted = defineDeliveryOutcome("accepted");
export const deliveryDelivered = defineDeliveryOutcome("delivered");
export const deliveryDelayed = defineDeliveryOutcome("delivery_delayed");
export const deliveryBounced = defineDeliveryOutcome("bounced");
export const deliveryComplained = defineDeliveryOutcome("complained");
export const deliveryOpened = defineDeliveryOutcome("opened");
export const deliveryClicked = defineDeliveryOutcome("clicked");

export const deliverySkipped = defineWebhookEvent({
  payload: Schema.Struct({
    delivery_id: Schema.String,
    message_id: Schema.String,
    reason: Schema.String,
  }),
  type: "delivery.skipped",
});

export type DeliveryWebhookEvent =
  | WebhookEventInput<typeof deliveryAccepted>
  | WebhookEventInput<typeof deliveryBounced>
  | WebhookEventInput<typeof deliveryClicked>
  | WebhookEventInput<typeof deliveryComplained>
  | WebhookEventInput<typeof deliveryDelayed>
  | WebhookEventInput<typeof deliveryDelivered>
  | WebhookEventInput<typeof deliveryOpened>
  | WebhookEventInput<typeof deliverySkipped>;
