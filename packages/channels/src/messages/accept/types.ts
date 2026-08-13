import type { DateTime } from "effect";

export type MessageAttribution =
  | { readonly kind: "project" }
  | {
      readonly app: string;
      readonly environment: string;
      readonly kind: "appEnvironment";
    };

export interface TransactionalMessageIntent {
  readonly attribution: MessageAttribution;
  readonly idempotencyKey?: string;
  readonly organizationId: string;
  readonly scheduledAt?: DateTime.Utc;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface AcceptedMessage {
  readonly messageId: string;
  readonly replayed: boolean;
}
