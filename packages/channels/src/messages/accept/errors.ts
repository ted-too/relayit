import { Data } from "effect";

export class MessageAcceptPersistenceError extends Data.TaggedError(
  "MessageAcceptPersistenceError"
)<{
  readonly cause: unknown;
  readonly messageId?: string;
  readonly operation:
    | "create_app_environment"
    | "expire_idempotency"
    | "find_app_environment"
    | "find_idempotency"
    | "record_idempotency"
    | "upsert_contact";
  readonly organizationAppEnvironmentId?: string;
  readonly organizationId?: string;
}> {}
