import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { createAwsErrorMapper } from "../errors";
import { UNRECORDED_SEND_GRACE_SECONDS } from "@repo/channels/email/deliverability";
import { ensureSesInfrastructure, sesNotificationDeliveryPolicy } from "./infrastructure";

const WEBHOOK_URL = "https://api.relayit.test/webhooks/providers/aws/ses";

/** SNS and SES in one region, holding one subscription to the api in the given state. */
const fakeAws = (
  subscriptionArn: string,
  setTopicAttributes: () => Effect.Effect<unknown, unknown> = () => Effect.succeed({}),
) => {
  const subscribed: string[] = [];
  const attributes: { AttributeName: string; AttributeValue: string; TopicArn: string }[] = [];
  const destinations: string[] = [];
  const sns = {
    createTopic: ({ Name }: { Name: string }) =>
      Effect.succeed({ TopicArn: `arn:aws:sns:us-east-1:111122223333:${Name}` }),
    listSubscriptionsByTopic: () =>
      Effect.succeed({
        Subscriptions: [
          { Endpoint: WEBHOOK_URL, Protocol: "https", SubscriptionArn: subscriptionArn },
        ],
      }),
    setTopicAttributes: (input: (typeof attributes)[number]) => {
      attributes.push(input);
      return setTopicAttributes();
    },
    subscribe: ({ Endpoint }: { Endpoint: string }) => {
      subscribed.push(Endpoint);
      return Effect.succeed({ SubscriptionArn: "PendingConfirmation" });
    },
  } as unknown as SNS.Type;
  const ses = {
    createConfigurationSet: () => Effect.succeed({}),
    createConfigurationSetEventDestination: ({
      EventDestinationName,
    }: {
      EventDestinationName: string;
    }) => {
      destinations.push(EventDestinationName);
      return Effect.succeed({});
    },
  } as unknown as SESv2.Type;
  const ensure = ensureSesInfrastructure({
    deliveryWebhookUrl: WEBHOOK_URL,
    mapAwsError: createAwsErrorMapper({ region: "us-east-1" }),
    region: "us-east-1",
    ses,
    sns,
  });
  return { attributes, destinations, ensure, subscribed };
};

describe("ensureSesInfrastructure", () => {
  it.effect("subscribes the api again while its subscription is still pending confirmation", () =>
    Effect.gen(function* () {
      const { ensure, subscribed } = fakeAws("PendingConfirmation");
      yield* ensure;
      expect(subscribed).toEqual([WEBHOOK_URL]);
    }),
  );

  it.effect("sets the topic's retry policy on every start, whatever the subscription's state", () =>
    Effect.gen(function* () {
      for (const subscriptionArn of [
        "PendingConfirmation",
        "arn:aws:sns:us-east-1:111122223333:relayit-delivery-x:5f1c0e1e",
      ]) {
        const { attributes, ensure } = fakeAws(subscriptionArn);
        // Two starts of the worker: the same value each time, so nothing accumulates.
        yield* ensure;
        yield* ensure;

        expect(attributes).toHaveLength(2);
        expect(attributes[0]).toEqual(attributes[1]);
        expect(attributes[0]).toMatchObject({
          AttributeName: "DeliveryPolicy",
          TopicArn: expect.stringMatching(/^arn:aws:sns:us-east-1:111122223333:relayit-delivery-/),
        });
        expect(JSON.parse(attributes[0]?.AttributeValue ?? "")).toEqual(
          sesNotificationDeliveryPolicy(UNRECORDED_SEND_GRACE_SECONDS),
        );
      }
    }),
  );

  it.effect("still ensures the rest when it may not set the topic's retry policy", () =>
    Effect.gen(function* () {
      // An IAM policy from before `sns:SetTopicAttributes` was needed.
      const { destinations, ensure, subscribed } = fakeAws("PendingConfirmation", () =>
        Effect.fail({ _tag: "AuthorizationErrorException" }),
      );
      yield* ensure;
      expect(subscribed).toEqual([WEBHOOK_URL]);
      expect(destinations).toHaveLength(1);
    }),
  );

  it("retries a refused notification for as long as the api refuses it, within SNS's limits", () => {
    const policy = sesNotificationDeliveryPolicy(UNRECORDED_SEND_GRACE_SECONDS).http
      .defaultHealthyRetryPolicy;
    const spanSeconds =
      policy.numMinDelayRetries * policy.minDelayTarget +
      policy.numMaxDelayRetries * policy.maxDelayTarget;

    // Every retry has a fixed delay, so the span is exact: none is in the backoff phase.
    expect(policy.numNoDelayRetries + policy.numMinDelayRetries + policy.numMaxDelayRetries).toBe(
      policy.numRetries,
    );
    // The retries last the grace, to within one of them, and never outlast it.
    expect(spanSeconds).toBeLessThanOrEqual(UNRECORDED_SEND_GRACE_SECONDS);
    expect(spanSeconds).toBeGreaterThan(UNRECORDED_SEND_GRACE_SECONDS - policy.maxDelayTarget);
    // SNS's documented limits for an HTTP/S delivery policy.
    expect(spanSeconds).toBeLessThanOrEqual(3600);
    expect(policy.numRetries).toBeLessThanOrEqual(100);
    expect(policy.minDelayTarget).toBeGreaterThanOrEqual(1);
    expect(policy.minDelayTarget).toBeLessThanOrEqual(policy.maxDelayTarget);
    expect(policy.maxDelayTarget).toBeLessThanOrEqual(3600);
  });

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
