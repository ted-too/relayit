import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import type {
  ProviderInstanceErrorContext,
  ProviderOperationError,
  ProviderTypeErrorContext,
} from "@repo/channels/provider-errors";
import {
  ProviderAuthenticationError,
  ProviderConfigurationError,
  ProviderRateLimited,
  ProviderRejected,
  ProviderUnavailable,
  ProviderWebhookError,
} from "@repo/channels/provider-errors";
import { Data, type Effect } from "effect";

export class AwsUnexpectedResponseError extends Data.TaggedError(
  "AwsUnexpectedResponseError"
)<{
  readonly missingField: "MessageId" | "TopicArn";
  readonly operation: "CreateTopic" | "SendEmail";
}> {}

export class AwsWebhookPayloadError extends Data.TaggedError(
  "AwsWebhookPayloadError"
)<{
  readonly cause?: unknown;
  readonly source: "ses_notification" | "sns_envelope";
}> {}

export class AwsSnsValidationError extends Data.TaggedError(
  "AwsSnsValidationError"
)<{
  readonly cause?: unknown;
}> {}

export class AwsSubscriptionConfirmationError extends Data.TaggedError(
  "AwsSubscriptionConfirmationError"
)<{
  readonly cause?: unknown;
  readonly hostname?: string;
  readonly protocol?: string;
  readonly reason: "invalid_url" | "request_failed";
  readonly status?: number;
}> {}

export type AwsWebhookError =
  | AwsSnsValidationError
  | AwsSubscriptionConfirmationError
  | AwsWebhookPayloadError;

type EffectError<T> =
  T extends Effect.Effect<unknown, infer Error, unknown> ? Error : never;

type SesOperation =
  | "createConfigurationSet"
  | "createConfigurationSetEventDestination"
  | "createEmailIdentity"
  | "deleteConfigurationSetEventDestination"
  | "deleteEmailIdentity"
  | "getAccount"
  | "getEmailIdentity"
  | "putEmailIdentityDkimSigningAttributes"
  | "putEmailIdentityMailFromAttributes"
  | "sendEmail"
  | "updateConfigurationSetEventDestination";

type SnsOperation =
  | "createTopic"
  | "deleteTopic"
  | "listSubscriptionsByTopic"
  | "listTopics"
  | "subscribe"
  | "unsubscribe";

type AwsProviderError =
  | AwsUnexpectedResponseError
  | EffectError<ReturnType<SESv2.Type[SesOperation]>>
  | EffectError<ReturnType<SNS.Type[SnsOperation]>>
  | ProviderOperationError;

export const createAwsErrorMapper =
  (context: ProviderInstanceErrorContext) =>
  (error: AwsProviderError): ProviderOperationError => {
    switch (error._tag) {
      case "ProviderAuthenticationError":
      case "ProviderConfigurationError":
      case "ProviderMessageError":
      case "ProviderRateLimited":
      case "ProviderRejected":
      case "ProviderUnavailable":
        return error;
      case "AuthorizationErrorException":
      case "InvalidSecurityException":
        return new ProviderAuthenticationError({ ...context, cause: error });
      case "FilterPolicyLimitExceededException":
      case "LimitExceededException":
      case "ReplayLimitExceededException":
      case "SubscriptionLimitExceededException":
      case "TooManyRequestsException":
      case "TopicLimitExceededException":
        return new ProviderRateLimited(context);
      case "AccountSuspendedException":
        return new ProviderRejected({
          ...context,
          cause: error,
          reason: "account_suspended",
        });
      case "MailFromDomainNotVerifiedException":
        return new ProviderRejected({
          ...context,
          cause: error,
          reason: "mail_from_domain_not_verified",
        });
      case "MessageRejected":
        return new ProviderRejected({
          ...context,
          cause: error,
          reason: "message_rejected",
        });
      case "SendingPausedException":
        return new ProviderRejected({
          ...context,
          cause: error,
          reason: "sending_paused",
        });
      case "BadRequestException":
      case "InvalidParameterException":
        return new ProviderConfigurationError({
          ...context,
          cause: error,
          code: "provider_configuration_rejected",
        });
      case "AlreadyExistsException":
      case "AwsUnexpectedResponseError":
      case "ConcurrentAccessException":
      case "ConcurrentModificationException":
      case "InternalErrorException":
      case "InvalidStateException":
      case "NotFoundException":
      case "SdkError":
      case "StaleTagException":
      case "TagLimitExceededException":
      case "TagPolicyException":
      case "TimeoutError":
        return new ProviderUnavailable({ ...context, cause: error });
      default: {
        const unhandledError: never = error;
        return new ProviderUnavailable({ ...context, cause: unhandledError });
      }
    }
  };

export type AwsErrorMapper = ReturnType<typeof createAwsErrorMapper>;

export const createAwsWebhookErrorMapper =
  (context: ProviderTypeErrorContext) =>
  (cause: AwsWebhookError): ProviderWebhookError =>
    new ProviderWebhookError({ ...context, cause });

export type AwsWebhookErrorMapper = ReturnType<
  typeof createAwsWebhookErrorMapper
>;
