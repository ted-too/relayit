import { Data } from "effect";

export class WebhookEmissionError extends Data.TaggedError(
  "WebhookEmissionError"
)<{
  readonly cause: unknown;
  readonly stage: "deliveries" | "endpoints" | "event" | "jobs";
}> {}

export class WebhookDeliveryRetryableError extends Data.TaggedError(
  "WebhookDeliveryRetryableError"
)<{
  readonly cause?: unknown;
  readonly deliveryId: string;
  readonly message: string;
}> {}

export class WebhookDeliveryTerminalError extends Data.TaggedError(
  "WebhookDeliveryTerminalError"
)<{
  readonly cause?: unknown;
  readonly deliveryId: string;
  readonly message: string;
}> {}

export class WebhookManagementError extends Data.TaggedError(
  "WebhookManagementError"
)<{
  readonly cause?: unknown;
  readonly code:
    | "delivery_not_found"
    | "endpoint_paused"
    | "endpoint_not_found"
    | "invalid_replay_state"
    | "operation_failed";
  readonly message: string;
}> {}
