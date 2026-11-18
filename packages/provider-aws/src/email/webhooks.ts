import { STS } from "@effect-aws/client-sts";
import type { NormalizedDeliveryEvent } from "@repo/channels/email/deliverability";
import { Context, Duration, Effect, Exit, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import MessageValidator from "sns-validator";
import {
  AwsSnsTopicRejected,
  AwsSnsTopicsUnavailable,
  AwsSnsValidationError,
  AwsSubscriptionConfirmationError,
  AwsUnexpectedResponseError,
  type AwsWebhookError,
  AwsWebhookPayloadError,
} from "../errors";
import type { EmailBackendConfig } from "./backend";
import { namesFor } from "./infrastructure";

/**
 * Where the api receives SES's notifications, and where the worker subscribes SNS. The
 * shape is left from when Providers were pluggable; production's SNS subscriptions point
 * here, so changing it means re-subscribing every region.
 */
export const SES_NOTIFICATIONS_PATH = "/webhooks/providers/aws/ses";

const TRAILING_SLASH = /\/$/;

/** The notifications URL of the api at `apiUrl`, as the worker subscribes it to SNS. */
export const sesNotificationsUrl = (apiUrl: URL) =>
  new URL(`${apiUrl.toString().replace(TRAILING_SLASH, "")}${SES_NOTIFICATIONS_PATH}`).toString();

/**
 * The SNS topics the worker subscribes the api to: one per region in `SES_REGIONS`, in the
 * deployment's SES account. SNS signs every topic's messages alike, so without this check
 * a topic in any AWS account could subscribe the api and report bounces it made up.
 */
export class SesNotificationTopics extends Context.Service<
  SesNotificationTopics,
  { readonly arns: Effect.Effect<ReadonlySet<string>, AwsSnsTopicsUnavailable> }
>()("ProviderAws/SesNotificationTopics") {}

const STS_TIMEOUT = Duration.seconds(5);

/**
 * The topics in the account `STS` signs in as, named as `ensureSesInfrastructure` names
 * them. The account is looked up on the first notification, and again on each one after
 * until a lookup succeeds, so the api starts without reaching AWS.
 */
export const sesNotificationTopicsInAccount = (input: {
  readonly apiUrl: URL;
  readonly regions: readonly string[];
}) =>
  Layer.effect(
    SesNotificationTopics,
    Effect.gen(function* () {
      const sts = yield* STS;
      const { topicName } = namesFor(sesNotificationsUrl(input.apiUrl));
      const arns = yield* Effect.gen(function* () {
        // Callers wait on one lookup at a time, so a stalled one must end: a timeout fails
        // it, which is not cached, and the next notification starts a fresh one.
        const identity = yield* sts.getCallerIdentity({}).pipe(Effect.timeout(STS_TIMEOUT));
        // The caller's own ARN names the partition (aws, aws-cn, …) the topics are in.
        const partition = identity.Arn?.split(":")[1];
        if (!identity.Account) {
          return yield* new AwsUnexpectedResponseError({
            missingField: "Account",
            operation: "GetCallerIdentity",
          });
        }
        if (!partition) {
          return yield* new AwsUnexpectedResponseError({
            missingField: "Arn",
            operation: "GetCallerIdentity",
          });
        }
        const account = identity.Account;
        const arns: ReadonlySet<string> = new Set(
          input.regions.map((region) => `arn:${partition}:sns:${region}:${account}:${topicName}`),
        );
        return arns;
      }).pipe(
        Effect.mapError((cause) => new AwsSnsTopicsUnavailable({ cause })),
        Effect.cachedWithTTL((exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero)),
      );
      return { arns };
    }),
  );

/**
 * The topics for the backend's config. The fake makes none, so with it the api accepts no
 * SNS message at all.
 */
export const sesNotificationTopicsLayer = (input: {
  readonly apiUrl: URL;
  readonly backend: EmailBackendConfig;
}) => {
  if (input.backend.kind === "fake") {
    return Layer.succeed(SesNotificationTopics, {
      arns: Effect.succeed(new Set<string>()),
    });
  }
  const { accessKeyId, regions, secretAccessKey } = input.backend.ses;
  return sesNotificationTopicsInAccount({ apiUrl: input.apiUrl, regions }).pipe(
    Layer.provide(STS.layer({ credentials: { accessKeyId, secretAccessKey }, region: regions[0] })),
  );
};

/**
 * What SES publishes, as plain text, to a topic the worker makes an event destination
 * (#53). It reports nothing about a send.
 */
const TOPIC_VALIDATION_MESSAGE =
  /^Successfully validated SNS topic for Amazon SES event publishing\.?$/;

export type SesNotificationResult =
  | { readonly events: readonly NormalizedDeliveryEvent[]; readonly type: "events" }
  | { readonly type: "noop" };

const validator = new MessageValidator();
const SNS_HOSTNAME = /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/;
const requestSubscription = (url: URL) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(url).pipe(
      Effect.mapError(
        (cause) =>
          new AwsSubscriptionConfirmationError({
            cause,
            reason: "request_failed",
          }),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new AwsSubscriptionConfirmationError({
        reason: "request_failed",
        status: response.status,
      });
    }
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
  );
const parseJson = (value: string, source: "ses_notification" | "sns_envelope") =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(
    Effect.mapError(
      (cause) =>
        new AwsWebhookPayloadError({
          cause,
          source,
        }),
    ),
  );

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const stringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const recipientsFor = (payload: Record<string, unknown>) => {
  const bounce = asRecord(payload.bounce);
  if (Array.isArray(bounce?.bouncedRecipients)) {
    return bounce.bouncedRecipients.flatMap((recipient) => {
      const address = asRecord(recipient)?.emailAddress;
      return typeof address === "string" ? [address] : [];
    });
  }

  const complaint = asRecord(payload.complaint);
  if (Array.isArray(complaint?.complainedRecipients)) {
    return complaint.complainedRecipients.flatMap((recipient) => {
      const address = asRecord(recipient)?.emailAddress;
      return typeof address === "string" ? [address] : [];
    });
  }

  const eventType = String(payload.eventType ?? payload.notificationType ?? "");
  const event = asRecord(payload[eventType.toLowerCase()]);
  const eventRecipients = stringArray(event?.recipients);
  if (eventRecipients.length > 0) {
    return eventRecipients;
  }

  return stringArray(asRecord(payload.mail)?.destination);
};

const eventKind = (notificationType: string): NormalizedDeliveryEvent["kind"] | undefined => {
  switch (notificationType.toLowerCase()) {
    case "send":
      return "accepted";
    case "delivery":
      return "delivered";
    case "deliverydelay":
      return "delivery_delayed";
    case "bounce":
    case "reject":
    case "renderingfailure":
      return "bounced";
    case "complaint":
      return "complained";
    case "open":
      return "opened";
    case "click":
      return "clicked";
    default:
      return;
  }
};

export const normalizeSesNotification = (
  payload: Record<string, unknown>,
  notificationId: string,
): SesNotificationResult => {
  const notificationType = String(payload.eventType ?? payload.notificationType ?? "");
  const kind = eventKind(notificationType);
  const providerMessageId = asRecord(payload.mail)?.messageId;

  if (!kind || typeof providerMessageId !== "string") {
    return { type: "noop" };
  }

  const bounceType = asRecord(payload.bounce)?.bounceType;
  const suppress = kind === "complained" || (kind === "bounced" && bounceType === "Permanent");

  return {
    events: [
      {
        kind,
        notificationId,
        providerMessageId,
        raw: payload,
        recipients: recipientsFor(payload),
        suppress,
      },
    ],
    type: "events",
  };
};

const validateSnsMessage = (message: unknown) =>
  Effect.callback<Record<string, unknown>, AwsWebhookError>((resume) => {
    try {
      const input = asRecord(message);
      if (!input) {
        resume(
          Effect.fail(
            new AwsWebhookPayloadError({
              source: "sns_envelope",
            }),
          ),
        );
        return;
      }
      validator.validate(input, (error, validated) => {
        if (error) {
          resume(
            Effect.fail(
              new AwsSnsValidationError({
                cause: error,
              }),
            ),
          );
          return;
        }
        const validatedMessage = asRecord(validated);
        resume(
          validatedMessage
            ? Effect.succeed(validatedMessage)
            : Effect.fail(
                new AwsWebhookPayloadError({
                  source: "sns_envelope",
                }),
              ),
        );
      });
    } catch (cause) {
      resume(
        Effect.fail(
          new AwsSnsValidationError({
            cause,
          }),
        ),
      );
    }
  });

const confirmSubscription = (value: unknown) =>
  Effect.gen(function* () {
    if (typeof value !== "string") {
      return yield* new AwsSubscriptionConfirmationError({
        reason: "invalid_url",
      });
    }

    const url = yield* Effect.try({
      catch: (cause) =>
        new AwsSubscriptionConfirmationError({
          cause,
          reason: "invalid_url",
        }),
      try: () => new URL(value),
    });
    if (url.protocol !== "https:" || !SNS_HOSTNAME.test(url.hostname)) {
      return yield* new AwsSubscriptionConfirmationError({
        hostname: url.hostname,
        protocol: url.protocol,
        reason: "invalid_url",
      });
    }

    yield* requestSubscription(url);
  });

/**
 * Reads one SNS delivery to the notifications endpoint: confirms a subscription, or
 * normalizes the SES event it carries. Every message is checked against SNS's signature,
 * then against the topics this deployment subscribed, before anything is confirmed or read.
 */
export const handleSesNotification = (rawBody: string) =>
  Effect.gen(function* () {
    const body = yield* parseJson(rawBody, "sns_envelope");
    const message = yield* validateSnsMessage(body);

    const topics = yield* SesNotificationTopics;
    const trusted = yield* topics.arns;
    if (typeof message.TopicArn !== "string" || !trusted.has(message.TopicArn)) {
      return yield* new AwsSnsTopicRejected({ topicArn: message.TopicArn });
    }

    if (message.Type === "SubscriptionConfirmation") {
      yield* confirmSubscription(message.SubscribeURL);
      return { type: "noop" } as const;
    }

    if (
      message.Type !== "Notification" ||
      typeof message.Message !== "string" ||
      typeof message.MessageId !== "string" ||
      TOPIC_VALIDATION_MESSAGE.test(message.Message.trim())
    ) {
      return { type: "noop" } as const;
    }

    const payload = yield* parseJson(message.Message, "ses_notification");
    const record = asRecord(payload);
    return record
      ? normalizeSesNotification(record, message.MessageId)
      : ({ type: "noop" } as const);
  });
