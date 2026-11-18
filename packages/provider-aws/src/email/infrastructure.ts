import type { EventBridge } from "@effect-aws/client-eventbridge";
import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import { EmailBackendConfigurationError } from "@repo/channels/email/backend";
import { UNRECORDED_SEND_GRACE_SECONDS } from "@repo/channels/email/deliverability";
import { Effect } from "effect";
import { type AwsErrorMapper, AwsUnexpectedResponseError } from "../errors";
import { ensureSesTenantStatusEvents } from "./tenant-status";

export const SES_CONFIGURATION_SET_NAME = "relayit-delivery-events";
const TOPIC_PREFIX = "relayit-delivery-";
const DESTINATION_PREFIX = "relayit-sns-";
const TENANT_STATUS_RULE_PREFIX = "relayit-tenant-status-";
const EVENT_TYPES = [
  "SEND",
  "DELIVERY",
  "BOUNCE",
  "COMPLAINT",
  "REJECT",
  "RENDERING_FAILURE",
  "DELIVERY_DELAY",
  "OPEN",
  "CLICK",
] as const;

const stableHash = (value: string) => {
  let hash = 17;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }
  return hash.toString(16).padStart(8, "0");
};

/** What the infrastructure for a webhook URL is called, the same in every region. */
export const namesFor = (deliveryWebhookUrl: string) => {
  const hash = stableHash(deliveryWebhookUrl);
  return {
    destinationName: `${DESTINATION_PREFIX}${hash}`,
    tenantStatusRuleName: `${TENANT_STATUS_RULE_PREFIX}${hash}`,
    topicName: `${TOPIC_PREFIX}${hash}`,
  };
};

const validateWebhookUrl = (value: string, region: string) =>
  Effect.try({
    catch: (cause) =>
      new EmailBackendConfigurationError({
        cause,
        code: "invalid_webhook_url",
        region,
      }),
    try: () => new URL(value),
  }).pipe(
    Effect.flatMap((url) =>
      url.protocol === "https:"
        ? Effect.succeed(url.toString())
        : Effect.fail(
            new EmailBackendConfigurationError({
              code: "invalid_webhook_url",
              region,
            }),
          ),
    ),
  );

const QUICK_RETRIES = 6;
const QUICK_DELAY_SECONDS = 5;
const SLOW_DELAY_SECONDS = 60;

/**
 * How SNS retries a notification the api answered with a 5xx, as the topic's `DeliveryPolicy`.
 * SNS's default for HTTP/S is three retries twenty seconds apart, after which the message is
 * discarded; the api refuses a notification that beat its Delivery's `sent` write for
 * `graceSeconds`, so the retries have to last that long: a few quick ones for the usual race
 * of a moment, then one a minute until the grace is spent. Only the phases with a fixed
 * delay are used (none in the backoff phase), so the total is plain arithmetic and never
 * passes the 3,600 seconds SNS allows.
 */
export const sesNotificationDeliveryPolicy = (graceSeconds: number) => {
  const slowRetries = Math.floor(
    (graceSeconds - QUICK_RETRIES * QUICK_DELAY_SECONDS) / SLOW_DELAY_SECONDS,
  );
  return {
    http: {
      defaultHealthyRetryPolicy: {
        backoffFunction: "linear",
        maxDelayTarget: SLOW_DELAY_SECONDS,
        minDelayTarget: QUICK_DELAY_SECONDS,
        numMaxDelayRetries: slowRetries,
        numMinDelayRetries: QUICK_RETRIES,
        numNoDelayRetries: 0,
        numRetries: QUICK_RETRIES + slowRetries,
      },
      disableSubscriptionOverrides: false,
    },
  };
};

const ensureTopicAndSubscription = (sns: SNS.Type, topicName: string, webhookUrl: string) =>
  Effect.gen(function* () {
    const topic = yield* sns.createTopic({ Name: topicName });
    const topicArn = topic.TopicArn;
    if (!topicArn) {
      return yield* new AwsUnexpectedResponseError({
        missingField: "TopicArn",
        operation: "CreateTopic",
      });
    }

    // On the topic, not the subscription: it is set on every start whatever state the
    // subscription is in, and outlives one that is made again. Setting it is not what
    // sending depends on, so a deployment whose IAM policy predates `sns:SetTopicAttributes`
    // keeps SNS's default and is told so, and the rest is still ensured.
    yield* sns
      .setTopicAttributes({
        AttributeName: "DeliveryPolicy",
        AttributeValue: JSON.stringify(
          sesNotificationDeliveryPolicy(UNRECORDED_SEND_GRACE_SECONDS),
        ),
        TopicArn: topicArn,
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning(
            "Failed to set the SES notification topic's retry policy; SNS retries a refused notification for about a minute only",
            { cause, topicArn },
          ),
        ),
      );

    const subscriptions = yield* sns.listSubscriptionsByTopic({
      TopicArn: topicArn,
    });
    // A subscription whose confirmation never reached the api stays pending and delivers
    // nothing; subscribing again makes SNS send a new confirmation.
    const exists = subscriptions.Subscriptions?.some(
      (subscription) =>
        subscription.Protocol === "https" &&
        subscription.Endpoint === webhookUrl &&
        subscription.SubscriptionArn !== "PendingConfirmation",
    );

    if (!exists) {
      yield* sns.subscribe({
        Endpoint: webhookUrl,
        Protocol: "https",
        ReturnSubscriptionArn: true,
        TopicArn: topicArn,
      });
    }

    return topicArn;
  });

const ensureEventDestination = (ses: SESv2.Type, destinationName: string, topicArn: string) =>
  Effect.gen(function* () {
    yield* ses
      .createConfigurationSet({
        ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
      })
      .pipe(Effect.catchTags({ AlreadyExistsException: () => Effect.void }));

    const eventDestination = {
      Enabled: true,
      MatchingEventTypes: [...EVENT_TYPES],
      SnsDestination: { TopicArn: topicArn },
    };

    yield* ses
      .createConfigurationSetEventDestination({
        ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
        EventDestination: eventDestination,
        EventDestinationName: destinationName,
      })
      .pipe(
        Effect.catchTags({
          AlreadyExistsException: () =>
            ses.updateConfigurationSetEventDestination({
              ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
              EventDestination: eventDestination,
              EventDestinationName: destinationName,
            }),
        }),
      );
  });

/**
 * The configuration set every send names, publishing every event to an SNS topic that is
 * subscribed to the api. Named after the webhook URL, so a deployment that keeps its URL
 * finds what it made before and changes nothing. The same topic is given SES's tenant
 * sending-status events, which sending does not wait for.
 */
export const ensureSesInfrastructure = ({
  deliveryWebhookUrl,
  events,
  mapAwsError,
  region,
  ses,
  sns,
}: {
  deliveryWebhookUrl: string;
  events: EventBridge.Type;
  mapAwsError: AwsErrorMapper;
  region: string;
  ses: SESv2.Type;
  sns: SNS.Type;
}) =>
  Effect.gen(function* () {
    const webhookUrl = yield* validateWebhookUrl(deliveryWebhookUrl, region);
    const { destinationName, tenantStatusRuleName, topicName } = namesFor(webhookUrl);
    const topicArn = yield* ensureTopicAndSubscription(sns, topicName, webhookUrl);
    // Never fails, whatever the account refuses of it: what sending needs comes after.
    yield* ensureSesTenantStatusEvents({ events, sns, tenantStatusRuleName, topicArn });
    yield* ensureEventDestination(ses, destinationName, topicArn);
  }).pipe(Effect.mapError(mapAwsError));
