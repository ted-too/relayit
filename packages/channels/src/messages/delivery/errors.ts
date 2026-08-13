import { Data } from "effect";

export class MessageDeliveryTerminalError extends Data.TaggedError(
  "MessageDeliveryTerminalError"
)<{
  readonly cause?: unknown;
  readonly deliveryId: string;
  readonly message: string;
  readonly stage: string;
}> {}

export class MessageDeliveryRetryableError extends Data.TaggedError(
  "MessageDeliveryRetryableError"
)<{
  readonly cause?: unknown;
  readonly deliveryId: string;
  readonly message: string;
  readonly stage: string;
}> {}

export class MessageDeliveryInfrastructureError extends Data.TaggedError(
  "MessageDeliveryInfrastructureError"
)<{
  readonly cause: unknown;
  readonly deliveryId?: string;
  readonly operation: "circuit" | "suppressions" | "usage";
  readonly organizationId?: string;
}> {}
