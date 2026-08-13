import type { EmailDeliveryEventKind } from "@repo/persistence/db/schema";
import type { Effect } from "effect";
import type { ProviderWebhookError } from "../provider-errors";

export interface ProviderWebhookInput {
  readonly headers: Headers;
  readonly rawBody: string;
}

export interface NormalizedDeliveryEvent {
  readonly kind: EmailDeliveryEventKind;
  readonly providerMessageId: string;
  readonly raw: unknown;
  readonly recipients: readonly string[];
  readonly suppress: boolean;
}

export type ProviderWebhookResult =
  | {
      readonly events: readonly NormalizedDeliveryEvent[];
      readonly type: "events";
    }
  | { readonly type: "noop" };

export interface EmailProviderWebhookAdapter {
  readonly handle: (
    input: ProviderWebhookInput
  ) => Effect.Effect<ProviderWebhookResult, ProviderWebhookError>;
}
