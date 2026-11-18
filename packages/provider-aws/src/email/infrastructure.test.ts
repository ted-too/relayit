import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { createAwsErrorMapper } from "../errors";
import { ensureSesInfrastructure } from "./infrastructure";

const WEBHOOK_URL = "https://api.relayit.test/webhooks/providers/aws/ses";

/** SNS and SES in one region, holding one subscription to the api in the given state. */
const fakeAws = (subscriptionArn: string) => {
  const subscribed: string[] = [];
  const sns = {
    createTopic: ({ Name }: { Name: string }) =>
      Effect.succeed({ TopicArn: `arn:aws:sns:us-east-1:111122223333:${Name}` }),
    listSubscriptionsByTopic: () =>
      Effect.succeed({
        Subscriptions: [
          { Endpoint: WEBHOOK_URL, Protocol: "https", SubscriptionArn: subscriptionArn },
        ],
      }),
    subscribe: ({ Endpoint }: { Endpoint: string }) => {
      subscribed.push(Endpoint);
      return Effect.succeed({ SubscriptionArn: "PendingConfirmation" });
    },
  } as unknown as SNS.Type;
  const ses = {
    createConfigurationSet: () => Effect.succeed({}),
    createConfigurationSetEventDestination: () => Effect.succeed({}),
  } as unknown as SESv2.Type;
  const ensure = ensureSesInfrastructure({
    deliveryWebhookUrl: WEBHOOK_URL,
    mapAwsError: createAwsErrorMapper({ region: "us-east-1" }),
    region: "us-east-1",
    ses,
    sns,
  });
  return { ensure, subscribed };
};

describe("ensureSesInfrastructure", () => {
  it.effect("subscribes the api again while its subscription is still pending confirmation", () =>
    Effect.gen(function* () {
      const { ensure, subscribed } = fakeAws("PendingConfirmation");
      yield* ensure;
      expect(subscribed).toEqual([WEBHOOK_URL]);
    }),
  );

  it.effect("leaves a confirmed subscription as it is", () =>
    Effect.gen(function* () {
      const { ensure, subscribed } = fakeAws(
        "arn:aws:sns:us-east-1:111122223333:relayit-delivery-x:5f1c0e1e",
      );
      yield* ensure;
      expect(subscribed).toEqual([]);
    }),
  );
});
