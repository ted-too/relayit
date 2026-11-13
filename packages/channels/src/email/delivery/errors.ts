import { Data } from "effect";

export class EmailDeliveryPersistenceError extends Data.TaggedError(
  "EmailDeliveryPersistenceError",
)<{
  readonly cause: unknown;
  readonly deliveryId: string;
  readonly operation: "load_attachments" | "load_delivery" | "update_status";
}> {}
