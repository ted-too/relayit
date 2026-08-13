import { Data } from "effect";

export type EmailAcceptAttachmentReason =
  | "blocked_extension"
  | "exceeds_size_limit"
  | "fetch_failed"
  | "invalid_base64";

export interface EmailAcceptRejectedDetails {
  /** Opaque secondary text (e.g. renderer output) — not for identifiers. */
  readonly detail?: string;
  readonly filename?: string;
  readonly maxBytes?: number;
  readonly reason?: EmailAcceptAttachmentReason;
  readonly status?: number;
  readonly variable?: string;
}

export class EmailAcceptRejected extends Data.TaggedError(
  "EmailAcceptRejected"
)<{
  readonly code:
    | "all_recipients_suppressed"
    | "broken_react_email_link"
    | "invalid_attachment"
    | "invalid_from_address"
    | "invalid_primitive_content"
    | "missing_email_variant"
    | "missing_react_email_artifact"
    | "missing_subject"
    | "missing_variable"
    | "no_recipients"
    | "react_email_render_failed"
    | "sandbox_recipient_not_member"
    | "template_not_found"
    | "type_mismatch"
    | "undeclared_placeholder";
  readonly details?: EmailAcceptRejectedDetails;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
}> {}

export class EmailAcceptInfrastructureError extends Data.TaggedError(
  "EmailAcceptInfrastructureError"
)<{
  readonly cause: unknown;
  readonly operation: "attachments" | "content" | "sender" | "suppressions";
  readonly organizationId: string;
}> {}

export class EmailAcceptPersistenceError extends Data.TaggedError(
  "EmailAcceptPersistenceError"
)<{
  readonly cause: unknown;
  readonly messageId: string;
  readonly operation:
    | "find_email_delivery"
    | "insert_email_delivery"
    | "insert_message";
}> {}
