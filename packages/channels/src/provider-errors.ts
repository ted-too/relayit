import type { Provider } from "@repo/persistence/db/schema";
import { Data } from "effect";
import type { ProviderTypeId } from "./provider-type";

export interface ProviderTypeErrorContext {
  readonly typeId: ProviderTypeId;
}

export interface ProviderInstanceErrorContext extends ProviderTypeErrorContext {
  readonly providerId: Provider["id"];
}

export class ProviderNotFound extends Data.TaggedError(
  "ProviderNotFound"
)<ProviderTypeErrorContext> {}

export class DuplicateProvider extends Data.TaggedError(
  "DuplicateProvider"
)<ProviderTypeErrorContext> {}

export class ProviderAuthenticationError extends Data.TaggedError(
  "ProviderAuthenticationError"
)<ProviderInstanceErrorContext & { readonly cause?: unknown }> {}

export class ProviderConfigurationError extends Data.TaggedError(
  "ProviderConfigurationError"
)<
  ProviderInstanceErrorContext & {
    readonly cause?: unknown;
    readonly code:
      | "invalid_credentials"
      | "invalid_webhook_url"
      | "provider_configuration_rejected";
  }
> {}

export class ProviderRateLimited extends Data.TaggedError(
  "ProviderRateLimited"
)<ProviderInstanceErrorContext & { readonly retryAfterMs?: number }> {}

export class ProviderRejected extends Data.TaggedError("ProviderRejected")<
  ProviderInstanceErrorContext & {
    readonly cause?: unknown;
    readonly reason: string;
  }
> {}

export class ProviderMessageError extends Data.TaggedError(
  "ProviderMessageError"
)<
  ProviderInstanceErrorContext & {
    readonly cause?: unknown;
    readonly code: "invalid_attachment_encoding";
    readonly filename: string;
  }
> {}

export class ProviderUnavailable extends Data.TaggedError(
  "ProviderUnavailable"
)<ProviderInstanceErrorContext & { readonly cause?: unknown }> {}

export class ProviderWebhookError extends Data.TaggedError(
  "ProviderWebhookError"
)<
  ProviderTypeErrorContext & {
    readonly cause?: unknown;
    readonly providerId?: Provider["id"];
  }
> {}

export type ProviderOperationError =
  | ProviderAuthenticationError
  | ProviderConfigurationError
  | ProviderMessageError
  | ProviderRateLimited
  | ProviderRejected
  | ProviderUnavailable;
