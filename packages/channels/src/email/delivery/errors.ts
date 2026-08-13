import { Data } from "effect";

export class EmailDeliveryPersistenceError extends Data.TaggedError(
  "EmailDeliveryPersistenceError"
)<{
  readonly cause: unknown;
  readonly deliveryId: string;
  readonly operation:
    | "load_attachments"
    | "load_delivery"
    | "load_identities"
    | "update_status";
}> {}

export class EmailDeliveryProviderError extends Data.TaggedError(
  "EmailDeliveryProviderError"
)<{
  readonly cause?: unknown;
  readonly deliveryId: string;
  readonly leaveActive: boolean;
  /** Static summary — put identifiers in `providerId` / `providerKind`, not here. */
  readonly message: string;
  readonly providerId: string;
  readonly providerKind?: "byo" | "managed";
}> {}
