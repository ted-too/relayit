import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import { EmailBackendConfigurationError } from "@repo/channels/email/backend";
import { Effect } from "effect";
import { type AwsErrorMapper, AwsUnexpectedResponseError } from "../errors";

export const SES_CONFIGURATION_SET_NAME = "relayit-delivery-events";
const TOPIC_PREFIX = "relayit-delivery-";
const DESTINATION_PREFIX = "relayit-sns-";
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

const namesFor = (deliveryWebhookUrl: string) => {
  const hash = stableHash(deliveryWebhookUrl);
  return {
    destinationName: `${DESTINATION_PREFIX}${hash}`,
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

    const subscriptions = yield* sns.listSubscriptionsByTopic({
      TopicArn: topicArn,
    });
    const exists = subscriptions.Subscriptions?.some(
      (subscription) => subscription.Protocol === "https" && subscription.Endpoint === webhookUrl,
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
 * finds what it made before and changes nothing.
 */
export const ensureSesInfrastructure = ({
  deliveryWebhookUrl,
  mapAwsError,
  region,
  ses,
  sns,
}: {
  deliveryWebhookUrl: string;
  mapAwsError: AwsErrorMapper;
  region: string;
  ses: SESv2.Type;
  sns: SNS.Type;
}) =>
  Effect.gen(function* () {
    const webhookUrl = yield* validateWebhookUrl(deliveryWebhookUrl, region);
    const { destinationName, topicName } = namesFor(webhookUrl);
    const topicArn = yield* ensureTopicAndSubscription(sns, topicName, webhookUrl);
    yield* ensureEventDestination(ses, destinationName, topicArn);
  }).pipe(Effect.mapError(mapAwsError));
