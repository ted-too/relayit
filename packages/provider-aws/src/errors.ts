import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import {
  EmailBackendAuthenticationError,
  EmailBackendConfigurationError,
  type EmailBackendError,
  EmailBackendRateLimited,
  EmailBackendRejected,
  EmailBackendUnavailable,
} from "@repo/channels/email/backend";
import { Data, type Effect } from "effect";
import type { SesOperation, SnsOperation } from "./operations";

export class AwsUnexpectedResponseError extends Data.TaggedError("AwsUnexpectedResponseError")<{
  readonly missingField:
    | "Account"
    | "Arn"
    | "MessageId"
    | "SendingStatusAggregate"
    | "TenantArn"
    | "TopicArn";
  readonly operation:
    | "CreateTenant"
    | "CreateTopic"
    | "GetCallerIdentity"
    | "GetReputationEntity"
    | "SendEmail";
}> {}

/** The rule, target or topic policy for SES's tenant sending-status events was not ensured. */
export class AwsTenantStatusEventsError extends Data.TaggedError("AwsTenantStatusEventsError")<{
  readonly cause?: unknown;
  readonly reason:
    | "rule_arn_missing"
    | "target_refused"
    | "topic_arn_unreadable"
    | "topic_policy_unreadable";
}> {}

export class AwsWebhookPayloadError extends Data.TaggedError("AwsWebhookPayloadError")<{
  readonly cause?: unknown;
  readonly source: "ses_notification" | "sns_envelope";
}> {}

export class AwsSnsValidationError extends Data.TaggedError("AwsSnsValidationError")<{
  readonly cause?: unknown;
}> {}

/** A validly signed SNS message from a topic this deployment did not subscribe the api to. */
export class AwsSnsTopicRejected extends Data.TaggedError("AwsSnsTopicRejected")<{
  readonly topicArn: unknown;
}> {}

/** The deployment's SES account could not be looked up, so no topic can be trusted yet. */
export class AwsSnsTopicsUnavailable extends Data.TaggedError("AwsSnsTopicsUnavailable")<{
  readonly cause: unknown;
}> {}

export class AwsSubscriptionConfirmationError extends Data.TaggedError(
  "AwsSubscriptionConfirmationError",
)<{
  readonly cause?: unknown;
  readonly hostname?: string;
  readonly protocol?: string;
  readonly reason: "invalid_url" | "request_failed";
  readonly status?: number;
}> {}

export type AwsWebhookError =
  | AwsSnsTopicRejected
  | AwsSnsValidationError
  | AwsSubscriptionConfirmationError
  | AwsWebhookPayloadError;

type EffectError<T> = T extends Effect.Effect<unknown, infer Error, unknown> ? Error : never;

type AwsError =
  | AwsUnexpectedResponseError
  | EffectError<ReturnType<SESv2.Type[SesOperation]>>
  | EffectError<ReturnType<SNS.Type[SnsOperation]>>
  | EmailBackendError;

/** Maps an SES or SNS failure in one region onto the email backend's errors. */
export const createAwsErrorMapper =
  (context: { readonly region: string }) =>
  (error: AwsError): EmailBackendError => {
    switch (error._tag) {
      case "EmailBackendAuthenticationError":
      case "EmailBackendConfigurationError":
      case "EmailBackendIdentityConflict":
      case "EmailBackendMessageError":
      case "EmailBackendRateLimited":
      case "EmailBackendRejected":
      case "EmailBackendUnavailable":
        return error;
      case "AuthorizationErrorException":
      case "InvalidSecurityException":
        return new EmailBackendAuthenticationError({ ...context, cause: error });
      case "FilterPolicyLimitExceededException":
      case "LimitExceededException":
      case "ReplayLimitExceededException":
      case "SubscriptionLimitExceededException":
      case "TooManyRequestsException":
      case "TopicLimitExceededException":
        return new EmailBackendRateLimited(context);
      case "AccountSuspendedException":
        return new EmailBackendRejected({
          ...context,
          cause: error,
          reason: "account_suspended",
        });
      case "MailFromDomainNotVerifiedException":
        return new EmailBackendRejected({
          ...context,
          cause: error,
          reason: "mail_from_domain_not_verified",
        });
      case "MessageRejected":
        return new EmailBackendRejected({
          ...context,
          cause: error,
          reason: "message_rejected",
        });
      case "SendingPausedException":
        return new EmailBackendRejected({
          ...context,
          cause: error,
          reason: "sending_paused",
        });
      case "BadRequestException":
      case "InvalidParameterException":
        return new EmailBackendConfigurationError({
          ...context,
          cause: error,
          code: "configuration_rejected",
        });
      case "AlreadyExistsException":
      case "AwsUnexpectedResponseError":
      case "ConcurrentAccessException":
      case "ConcurrentModificationException":
      case "InternalErrorException":
      case "NotFoundException":
      case "SdkError":
      case "StaleTagException":
      case "TagLimitExceededException":
      case "TagPolicyException":
      case "TimeoutError":
        return new EmailBackendUnavailable({ ...context, cause: error });
      default: {
        const unhandledError: never = error;
        return new EmailBackendUnavailable({ ...context, cause: unhandledError });
      }
    }
  };

export type AwsErrorMapper = ReturnType<typeof createAwsErrorMapper>;
