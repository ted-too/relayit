import type { ProviderError } from "./interface";

export const PROVIDER_ERRORS = {
  NO_PAYLOAD_PROVIDED: {
    code: "NO_PAYLOAD_PROVIDED",
    message: "No payload provided",
    retryable: false,
  },
  PROVIDER_NOT_FOUND: {
    code: "PROVIDER_NOT_FOUND",
    message: "Provider not found",
    retryable: false,
  },
  RECIPIENT_NOT_FOUND: {
    code: "RECIPIENT_NOT_FOUND",
    message: "Recipient not found",
    retryable: false,
  },
  UNHANDLED_ERROR: {
    code: "UNHANDLED_ERROR",
    message: "Unhandled error",
    retryable: false,
  },
} as const satisfies Record<string, ProviderError>;
