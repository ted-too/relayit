import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";
import { STS } from "@effect-aws/client-sts";
import { afterAll, beforeAll, describe, expect, it, vi } from "@effect/vitest";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeStream from "node:stream";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { createAwsErrorMapper } from "../errors";
import { ensureSesInfrastructure } from "./infrastructure";
import {
  handleSesNotification,
  normalizeSesNotification,
  sesNotificationsUrl,
  sesNotificationTopicsInAccount,
  sesNotificationTopicsLayer,
} from "./webhooks";

const mail = {
  destination: ["recipient@example.com"],
  messageId: "provider-message-id",
};

describe("normalizeSesNotification", () => {
  it("normalizes delivery events", () => {
    expect(
      normalizeSesNotification(
        {
          delivery: { recipients: ["recipient@example.com"] },
          mail,
          notificationType: "Delivery",
        },
        "sns-message-id",
      ),
    ).toEqual({
      events: [
        {
          kind: "delivered",
          notificationId: "sns-message-id",
          providerMessageId: "provider-message-id",
          raw: {
            delivery: { recipients: ["recipient@example.com"] },
            mail,
            notificationType: "Delivery",
          },
          recipients: ["recipient@example.com"],
          sentAt: null,
          suppress: false,
        },
      ],
      type: "events",
    });
  });

  it("reads when SES took the message, or that the notification does not say", () => {
    const sentAt = (timestamp: unknown) => {
      const result = normalizeSesNotification(
        { mail: { ...mail, timestamp }, notificationType: "Bounce" },
        "sns-message-id",
      );
      return result.type === "events" ? result.events[0]?.sentAt : undefined;
    };

    expect(sentAt("2026-11-18T09:30:00.000Z")).toEqual(new Date("2026-11-18T09:30:00.000Z"));
    expect(sentAt("not a time")).toBeNull();
    expect(sentAt(1_795_000_000)).toBeNull();
  });

  it("suppresses permanent bounces", () => {
    const result = normalizeSesNotification(
      {
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "bad@example.com" }],
        },
        mail,
        notificationType: "Bounce",
      },
      "sns-message-id",
    );

    expect(result.type).toBe("events");
    if (result.type === "events") {
      expect(result.events[0]?.kind).toBe("bounced");
      expect(result.events[0]?.recipients).toEqual(["bad@example.com"]);
      expect(result.events[0]?.suppress).toBe(true);
    }
  });

  it("ignores unrelated SES notifications", () => {
    expect(
      normalizeSesNotification({ mail, notificationType: "Received" }, "sns-message-id"),
    ).toEqual({ type: "noop" });
  });
});

const API_URL = new URL("https://api.relayit.test/");
const ACCOUNT = "111122223333";
const REGIONS = ["us-east-1", "eu-west-1"];

// SNS signs with a key whose certificate the validator downloads from SNS; the test signs
// with its own and serves it in that download's place.
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";
const keys = NodeCrypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
const https = NodeModule.createRequire(import.meta.url)("https") as {
  get: (url: string, callback: (response: NodeStream.Readable) => void) => unknown;
};
let certificateRequests: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  certificateRequests = vi.spyOn(https, "get").mockImplementation((url, callback) => {
    expect(url).toBe(CERT_URL);
    const response = Object.assign(NodeStream.Readable.from([Buffer.from(keys.publicKey)]), {
      statusCode: 200,
    });
    callback(response);
    return { destroy: () => undefined, on: () => undefined, setTimeout: () => undefined };
  });
});
afterAll(() => certificateRequests.mockRestore());

const SIGNED_KEYS = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
} as const;

/** An SNS delivery, signed as SNS signs one. */
const snsBody = (
  fields: { readonly TopicArn: string; readonly Type: keyof typeof SIGNED_KEYS } & Record<
    string,
    string
  >,
) => {
  const message: Record<string, string> = {
    MessageId: Bun.randomUUIDv7(),
    SignatureVersion: "2",
    SigningCertURL: CERT_URL,
    Timestamp: "2026-11-18T00:20:38.000Z",
    ...fields,
  };
  const signer = NodeCrypto.createSign("RSA-SHA256");
  for (const key of SIGNED_KEYS[fields.Type]) {
    if (key in message) {
      signer.update(`${key}\n${message[key]}\n`);
    }
  }
  return JSON.stringify({ ...message, Signature: signer.sign(keys.privateKey, "base64") });
};

/** The topic the worker makes in `region` of `account`, as SNS names it back. */
const workerTopic = (region: string, account = ACCOUNT) =>
  Effect.gen(function* () {
    let topicArn = "";
    const sns = {
      createTopic: ({ Name }: { Name: string }) => {
        topicArn = `arn:aws:sns:${region}:${account}:${Name}`;
        return Effect.succeed({ TopicArn: topicArn });
      },
      listSubscriptionsByTopic: () => Effect.succeed({ Subscriptions: [] }),
      setTopicAttributes: () => Effect.succeed({}),
      subscribe: () => Effect.succeed({}),
    } as unknown as SNS.Type;
    const ses = {
      createConfigurationSet: () => Effect.succeed({}),
      createConfigurationSetEventDestination: () => Effect.succeed({}),
    } as unknown as SESv2.Type;
    yield* ensureSesInfrastructure({
      deliveryWebhookUrl: sesNotificationsUrl(API_URL),
      mapAwsError: createAwsErrorMapper({ region }),
      region,
      ses,
      sns,
    });
    return topicArn;
  });

/** STS answering for the deployment's account, after failing `failures` times. */
const stsFor = (failures = 0) => {
  let calls = 0;
  return Layer.succeed(STS, {
    getCallerIdentity: () => {
      calls += 1;
      return calls <= failures
        ? Effect.fail(new Error("STS unreachable"))
        : Effect.succeed({ Account: ACCOUNT, Arn: `arn:aws:iam::${ACCOUNT}:user/relayit` });
    },
  } as unknown as STS.Type);
};

const deploymentTopics = sesNotificationTopicsInAccount({ apiUrl: API_URL, regions: REGIONS });

const bounce = JSON.stringify({
  bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "bad@example.com" }] },
  eventType: "Bounce",
  mail,
});

describe("handleSesNotification", () => {
  it.live("reads a notification from a topic the worker made in any of SES_REGIONS", () =>
    Effect.gen(function* () {
      for (const region of REGIONS) {
        const body = snsBody({
          Message: bounce,
          MessageId: `sns-${region}`,
          TopicArn: yield* workerTopic(region),
          Type: "Notification",
        });
        const result = yield* handleSesNotification(body);
        expect(result).toMatchObject({
          events: [{ kind: "bounced", notificationId: `sns-${region}` }],
          type: "events",
        });
      }
    }).pipe(Effect.provide(deploymentTopics.pipe(Layer.provide(stsFor())))),
  );

  it.live("rejects a signed notification from the same topic name in another account", () =>
    Effect.gen(function* () {
      const body = snsBody({
        Message: bounce,
        TopicArn: yield* workerTopic("us-east-1", "999999999999"),
        Type: "Notification",
      });
      const error = yield* Effect.flip(handleSesNotification(body));
      expect(error._tag).toBe("AwsSnsTopicRejected");
    }).pipe(Effect.provide(deploymentTopics.pipe(Layer.provide(stsFor())))),
  );

  it.live("confirms a subscription only from the deployment's own topic", () =>
    Effect.gen(function* () {
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(() => Promise.resolve(new Response("", { status: 200 })));
      const confirmation = (topicArn: string) =>
        snsBody({
          Message: "You have chosen to subscribe to the topic.",
          SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${topicArn}`,
          Token: "token",
          TopicArn: topicArn,
          Type: "SubscriptionConfirmation",
        });

      const foreign = yield* Effect.flip(
        handleSesNotification(confirmation(yield* workerTopic("us-east-1", "999999999999"))),
      );
      expect(foreign._tag).toBe("AwsSnsTopicRejected");
      expect(fetch).not.toHaveBeenCalled();

      const own = yield* workerTopic("us-east-1");
      expect(yield* handleSesNotification(confirmation(own))).toEqual({ type: "noop" });
      expect(fetch).toHaveBeenCalledTimes(1);
      fetch.mockRestore();
    }).pipe(Effect.provide(deploymentTopics.pipe(Layer.provide(stsFor())))),
  );

  it.live("accepts SES's plain-text topic validation and still rejects a malformed one", () =>
    Effect.gen(function* () {
      const topicArn = yield* workerTopic("us-east-1");
      const validation = snsBody({
        Message: "Successfully validated SNS topic for Amazon SES event publishing.",
        TopicArn: topicArn,
        Type: "Notification",
      });
      expect(yield* handleSesNotification(validation)).toEqual({ type: "noop" });

      const malformed = snsBody({ Message: "not json", TopicArn: topicArn, Type: "Notification" });
      const error = yield* Effect.flip(handleSesNotification(malformed));
      expect(error._tag).toBe("AwsWebhookPayloadError");
    }).pipe(Effect.provide(deploymentTopics.pipe(Layer.provide(stsFor())))),
  );

  it.live("looks the account up again after a failed lookup", () =>
    Effect.gen(function* () {
      const body = snsBody({
        Message: bounce,
        TopicArn: yield* workerTopic("us-east-1"),
        Type: "Notification",
      });
      const error = yield* Effect.flip(handleSesNotification(body));
      expect(error._tag).toBe("AwsSnsTopicsUnavailable");
      expect(yield* handleSesNotification(body)).toMatchObject({ type: "events" });
    }).pipe(Effect.provide(deploymentTopics.pipe(Layer.provide(stsFor(1))))),
  );

  it.effect("gives up on a stalled account lookup after 5s and looks it up again", () =>
    Effect.gen(function* () {
      const stalled = yield* Deferred.make<void>();
      let calls = 0;
      const sts = Layer.succeed(STS, {
        getCallerIdentity: () => {
          calls += 1;
          return calls === 1
            ? Deferred.succeed(stalled, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.succeed({ Account: ACCOUNT, Arn: `arn:aws:iam::${ACCOUNT}:user/relayit` });
        },
      } as unknown as STS.Type);
      const body = snsBody({
        Message: bounce,
        TopicArn: yield* workerTopic("us-east-1"),
        Type: "Notification",
      });

      yield* Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(Effect.flip(handleSesNotification(body)));
        yield* Deferred.await(stalled);
        yield* TestClock.adjust("5 seconds");
        expect((yield* Fiber.join(waiting))._tag).toBe("AwsSnsTopicsUnavailable");
        expect(yield* handleSesNotification(body)).toMatchObject({ type: "events" });
        expect(calls).toBe(2);
      }).pipe(Effect.provide(deploymentTopics.pipe(Layer.provide(sts))));
    }),
  );

  it.live("trusts no topic when email is fake", () =>
    Effect.gen(function* () {
      const body = snsBody({
        Message: bounce,
        TopicArn: yield* workerTopic("us-east-1"),
        Type: "Notification",
      });
      const error = yield* Effect.flip(handleSesNotification(body));
      expect(error._tag).toBe("AwsSnsTopicRejected");
    }).pipe(
      Effect.provide(
        sesNotificationTopicsLayer({
          apiUrl: API_URL,
          backend: { defaultRegion: "fake", kind: "fake" },
        }),
      ),
    ),
  );
});
