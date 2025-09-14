import type { ProviderError } from "@/providers/interface";

export const AWS_SES_ERRORS = {
  THROTTLING: {
    code: "THROTTLING_EXCEPTION",
    message: "Request was throttled by AWS SES",
    retryable: true,
  },
  SERVICE_UNAVAILABLE: {
    code: "SERVICE_UNAVAILABLE",
    message: "AWS SES service temporarily unavailable",
    retryable: true,
  },
  INTERNAL_FAILURE: {
    code: "INTERNAL_FAILURE",
    message: "AWS SES internal server error",
    retryable: true,
  },

  // Permanent errors
  INVALID_CREDENTIALS: {
    code: "INVALID_CREDENTIALS",
    message: "AWS credentials are invalid",
    retryable: false,
  },
  SENDING_QUOTA_EXCEEDED: {
    code: "SENDING_QUOTA_EXCEEDED",
    message: "AWS SES sending quota exceeded",
    retryable: false,
  },
  INVALID_EMAIL: {
    code: "INVALID_EMAIL",
    message: "Invalid email address format",
    retryable: false,
  },
  CONFIGURATION_SET_NOT_FOUND: {
    code: "CONFIGURATION_SET_NOT_FOUND",
    message: "AWS SES configuration set not found",
    retryable: false,
  },
} as const satisfies Record<string, ProviderError>;

export function categorizeAWSError(awsError: any): ProviderError {
  const errorName = awsError?.name || awsError?.code || "UNKNOWN_ERROR";
  const httpStatusCode = awsError?.$metadata?.httpStatusCode;

  switch (errorName) {
    case "ThrottlingException":
      return AWS_SES_ERRORS.THROTTLING;
    case "ServiceUnavailableException":
      return AWS_SES_ERRORS.SERVICE_UNAVAILABLE;
    case "InternalFailure":
      return AWS_SES_ERRORS.INTERNAL_FAILURE;
    case "InvalidParameterValue":
    case "InvalidParameter":
      return AWS_SES_ERRORS.INVALID_EMAIL;
    case "SendingQuotaExceededException":
      return AWS_SES_ERRORS.SENDING_QUOTA_EXCEEDED;
    case "ConfigurationSetDoesNotExistException":
      return AWS_SES_ERRORS.CONFIGURATION_SET_NOT_FOUND;
    case "CredentialsError":
    case "UnauthorizedOperation":
    case "InvalidUserID.NotFound":
      return AWS_SES_ERRORS.INVALID_CREDENTIALS;
    default:
      break;
  }

  if (httpStatusCode) {
    if (httpStatusCode >= 500) {
      return AWS_SES_ERRORS.INTERNAL_FAILURE;
    }
    if (httpStatusCode === 429) {
      return AWS_SES_ERRORS.THROTTLING;
    }
    if (httpStatusCode >= 400 && httpStatusCode < 500) {
      return AWS_SES_ERRORS.INVALID_EMAIL;
    }
  }

  return {
    code: "AWS_UNKNOWN_ERROR",
    message: awsError?.message || "Unknown AWS SES error",
    retryable: true,
  };
}
