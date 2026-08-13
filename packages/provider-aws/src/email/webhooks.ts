import type {
  EmailProviderWebhookAdapter,
  NormalizedDeliveryEvent,
  ProviderWebhookResult,
} from "@repo/channels/email/provider-webhook";
import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import MessageValidator from "sns-validator";
import {
  AwsSnsValidationError,
  AwsSubscriptionConfirmationError,
  type AwsWebhookError,
  type AwsWebhookErrorMapper,
  AwsWebhookPayloadError,
} from "../errors";

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
          })
      )
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new AwsSubscriptionConfirmationError({
        reason: "request_failed",
        status: response.status,
      });
    }
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" })
  );
const parseJson = (
  value: string,
  source: "ses_notification" | "sns_envelope"
) =>
  Schema.decodeEffect(Schema.UnknownFromJsonString)(value).pipe(
    Effect.mapError(
      (cause) =>
        new AwsWebhookPayloadError({
          cause,
          source,
        })
    )
  );

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

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

const eventKind = (
  notificationType: string
): NormalizedDeliveryEvent["kind"] | undefined => {
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
  payload: Record<string, unknown>
): ProviderWebhookResult => {
  const notificationType = String(
    payload.eventType ?? payload.notificationType ?? ""
  );
  const kind = eventKind(notificationType);
  const providerMessageId = asRecord(payload.mail)?.messageId;

  if (!kind || typeof providerMessageId !== "string") {
    return { type: "noop" };
  }

  const bounceType = asRecord(payload.bounce)?.bounceType;
  const suppress =
    kind === "complained" || (kind === "bounced" && bounceType === "Permanent");

  return {
    events: [
      {
        kind,
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
            })
          )
        );
        return;
      }
      validator.validate(input, (error, validated) => {
        if (error) {
          resume(
            Effect.fail(
              new AwsSnsValidationError({
                cause: error,
              })
            )
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
                })
              )
        );
      });
    } catch (cause) {
      resume(
        Effect.fail(
          new AwsSnsValidationError({
            cause,
          })
        )
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

export const createAwsSesWebhooks = (mapWebhookError: AwsWebhookErrorMapper) =>
  ({
    handle: ({ rawBody }) =>
      Effect.gen(function* () {
        const body = yield* parseJson(rawBody, "sns_envelope");
        const message = yield* validateSnsMessage(body);

        if (message.Type === "SubscriptionConfirmation") {
          yield* confirmSubscription(message.SubscribeURL);
          return { type: "noop" } as const;
        }

        if (
          message.Type !== "Notification" ||
          typeof message.Message !== "string"
        ) {
          return { type: "noop" } as const;
        }

        const payload = yield* parseJson(message.Message, "ses_notification");
        const record = asRecord(payload);
        return record
          ? normalizeSesNotification(record)
          : ({ type: "noop" } as const);
      }).pipe(Effect.mapError(mapWebhookError)),
  }) satisfies EmailProviderWebhookAdapter;
