import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import type { EmailProviderInfrastructureAdapter } from "@repo/channels/email/provider-infrastructure";
import type { ProviderInstanceErrorContext } from "@repo/channels/provider-errors";
import { ProviderConfigurationError } from "@repo/channels/provider-errors";
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

const validateWebhookUrl = (
  value: string,
  context: ProviderInstanceErrorContext
) =>
  Effect.try({
    catch: (cause) =>
      new ProviderConfigurationError({
        ...context,
        cause,
        code: "invalid_webhook_url",
      }),
    try: () => new URL(value),
  }).pipe(
    Effect.flatMap((url) =>
      url.protocol === "https:"
        ? Effect.succeed(url.toString())
        : Effect.fail(
            new ProviderConfigurationError({
              ...context,
              code: "invalid_webhook_url",
            })
          )
    )
  );

const ensureTopicAndSubscription = (
  sns: SNS.Type,
  topicName: string,
  webhookUrl: string
) =>
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
      (subscription) =>
        subscription.Protocol === "https" &&
        subscription.Endpoint === webhookUrl
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

const findTopicArn = (sns: SNS.Type, topicName: string) =>
  Effect.gen(function* () {
    let nextToken: string | undefined;

    do {
      const page = yield* sns.listTopics({ NextToken: nextToken });
      const topicArn = page.Topics?.find((topic) =>
        topic.TopicArn?.endsWith(`:${topicName}`)
      )?.TopicArn;

      if (topicArn) {
        return topicArn;
      }

      nextToken = page.NextToken;
    } while (nextToken);

    return;
  });

const ensureEventDestination = (
  ses: SESv2.Type,
  destinationName: string,
  topicArn: string
) =>
  Effect.gen(function* () {
    yield* ses
      .createConfigurationSet({
        ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
      })
      .pipe(Effect.catchTag("AlreadyExistsException", () => Effect.void));

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
        Effect.catchTag("AlreadyExistsException", () =>
          ses.updateConfigurationSetEventDestination({
            ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
            EventDestination: eventDestination,
            EventDestinationName: destinationName,
          })
        )
      );
  });

export const createAwsSesInfrastructure = ({
  context,
  mapAwsError,
  ses,
  sns,
}: {
  context: ProviderInstanceErrorContext;
  mapAwsError: AwsErrorMapper;
  ses: SESv2.Type;
  sns: SNS.Type;
}) =>
  ({
    ensure: ({ deliveryWebhookUrl }) =>
      Effect.gen(function* () {
        const webhookUrl = yield* validateWebhookUrl(
          deliveryWebhookUrl,
          context
        );
        const { destinationName, topicName } = namesFor(webhookUrl);
        const topicArn = yield* ensureTopicAndSubscription(
          sns,
          topicName,
          webhookUrl
        );
        yield* ensureEventDestination(ses, destinationName, topicArn);
        return { managedDnsRecords: [] };
      }).pipe(Effect.mapError(mapAwsError)),
    teardown: ({ deliveryWebhookUrl }) =>
      Effect.gen(function* () {
        const webhookUrl = yield* validateWebhookUrl(
          deliveryWebhookUrl,
          context
        );
        const { destinationName, topicName } = namesFor(webhookUrl);

        yield* ses
          .deleteConfigurationSetEventDestination({
            ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
            EventDestinationName: destinationName,
          })
          .pipe(Effect.catchTag("NotFoundException", () => Effect.void));

        const topicArn = yield* findTopicArn(sns, topicName);
        if (!topicArn) {
          return;
        }
        const subscriptions = yield* sns.listSubscriptionsByTopic({
          TopicArn: topicArn,
        });
        for (const subscription of subscriptions.Subscriptions ?? []) {
          if (
            subscription.Endpoint === webhookUrl &&
            subscription.SubscriptionArn &&
            subscription.SubscriptionArn !== "PendingConfirmation"
          ) {
            yield* sns.unsubscribe({
              SubscriptionArn: subscription.SubscriptionArn,
            });
          }
        }
        yield* sns.deleteTopic({ TopicArn: topicArn });
      }).pipe(Effect.mapError(mapAwsError)),
  }) satisfies EmailProviderInfrastructureAdapter;
