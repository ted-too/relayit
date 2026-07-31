import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  type EventDestination,
  EventType,
  type SESv2Client,
} from "@aws-sdk/client-sesv2";
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SubscribeCommand,
  UnsubscribeCommand,
} from "@aws-sdk/client-sns";
import type { ChannelCredentials } from "@repo/api/channels/base";
import type {
  NormalizedDeliveryEvent,
  WebhookResult,
} from "@repo/api/channels/email/types";
import type { EmailDeliveryEventKind } from "@repo/api/db";
import { logger } from "@repo/api/utils";
import MessageValidator from "sns-validator";
import { buildSesClient, buildSnsClient } from "./clients";

export const SES_CONFIGURATION_SET_NAME = "relayit-default";
export const SES_EVENTS_SNS_TOPIC_NAME = "relayit-email-events";

const snsValidator = new MessageValidator();

function isAlreadyExists(error: unknown) {
  return (
    (error as { name?: string }).name === "AlreadyExistsException" ||
    (error as { name?: string }).name ===
      "ConfigurationSetAlreadyExistsException"
  );
}

function isNotFound(error: unknown) {
  return (error as { name?: string }).name === "NotFoundException";
}

async function resolveTopicArn(
  sns: ReturnType<typeof buildSnsClient>,
  topicName: string
) {
  const createResult = await sns.send(
    new CreateTopicCommand({ Name: topicName })
  );

  if (!createResult.TopicArn) {
    throw new Error(`SNS topic ${topicName} did not return an ARN`);
  }

  return createResult.TopicArn;
}

async function ensureHttpsSubscription({
  sns,
  topicArn,
  webhookUrl,
}: {
  sns: ReturnType<typeof buildSnsClient>;
  topicArn: string;
  webhookUrl: string;
}) {
  const subscriptions = await sns.send(
    new ListSubscriptionsByTopicCommand({ TopicArn: topicArn })
  );

  const alreadySubscribed = (subscriptions.Subscriptions ?? []).some(
    (subscription) =>
      subscription.Protocol === "https" && subscription.Endpoint === webhookUrl
  );

  if (alreadySubscribed) {
    return;
  }

  await sns.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "https",
      Endpoint: webhookUrl,
      ReturnSubscriptionArn: true,
    })
  );
}

async function ensureConfigurationSetEvents({
  ses,
  topicArn,
}: {
  ses: SESv2Client;
  topicArn: string;
}) {
  try {
    await ses.send(
      new CreateConfigurationSetCommand({
        ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
      })
    );
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
  }

  const eventDestination: EventDestination = {
    Name: "relayit-sns-events",
    Enabled: true,
    MatchingEventTypes: [
      EventType.BOUNCE,
      EventType.COMPLAINT,
      EventType.DELIVERY,
    ],
    SnsDestination: {
      TopicArn: topicArn,
    },
  };

  try {
    await ses.send(
      new CreateConfigurationSetEventDestinationCommand({
        ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
        EventDestinationName: "relayit-sns-events",
        EventDestination: eventDestination,
      })
    );
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
  }
}

function mapSesEventKind(
  notificationType: string
): EmailDeliveryEventKind | null {
  switch (notificationType) {
    case "Bounce":
      return "bounced";
    case "Complaint":
      return "complained";
    case "Delivery":
      return "delivered";
    case "Reject":
      return "bounced";
    case "DeliveryDelay":
      return "delivery_delayed";
    default:
      return null;
  }
}

function extractRecipients(payload: Record<string, unknown>): string[] {
  const bounce = payload.bounce as
    | { bouncedRecipients?: Array<{ emailAddress?: string }> }
    | undefined;
  if (bounce?.bouncedRecipients) {
    return bounce.bouncedRecipients
      .map((r) => r.emailAddress)
      .filter((email): email is string => Boolean(email));
  }

  const complaint = payload.complaint as
    | { complainedRecipients?: Array<{ emailAddress?: string }> }
    | undefined;
  if (complaint?.complainedRecipients) {
    return complaint.complainedRecipients
      .map((r) => r.emailAddress)
      .filter((email): email is string => Boolean(email));
  }

  const delivery = payload.delivery as { recipients?: string[] } | undefined;
  if (delivery?.recipients) {
    return delivery.recipients;
  }

  const mail = payload.mail as { destination?: string[] } | undefined;
  return mail?.destination ?? [];
}

function shouldSuppress(
  payload: Record<string, unknown>,
  kind: EmailDeliveryEventKind
) {
  if (kind === "complained") {
    return true;
  }

  if (kind === "bounced") {
    const bounce = payload.bounce as { bounceType?: string } | undefined;
    // SES Reject has no bounce payload — treat as permanent failure.
    if (!bounce) {
      return true;
    }
    return bounce.bounceType === "Permanent";
  }

  return false;
}

function parseSesEventNotification(
  message: Record<string, unknown>
): NormalizedDeliveryEvent[] {
  const notificationType = String(message.notificationType ?? "");
  const kind = mapSesEventKind(notificationType);
  if (!kind) {
    return [];
  }

  const mail = message.mail as { messageId?: string } | undefined;
  const providerMessageId = mail?.messageId;
  if (!providerMessageId) {
    return [];
  }

  return [
    {
      kind,
      providerMessageId,
      recipients: extractRecipients(message),
      suppress: shouldSuppress(message, kind),
      raw: message,
    },
  ];
}

function parseInboundReceipt(
  message: Record<string, unknown>
): WebhookResult | null {
  if (message.notificationType !== "Received") {
    return null;
  }

  const content = message.content;
  if (typeof content !== "string" || content.length === 0) {
    return null;
  }

  const receipt = message.receipt as { recipients?: string[] } | undefined;
  const mail = message.mail as { destination?: string[] } | undefined;
  const recipients = receipt?.recipients ?? mail?.destination ?? [];

  const email = Uint8Array.from(Buffer.from(content, "base64"));
  return { type: "inbound", email, recipients };
}

export async function ensureSesEventNotifications({
  credentials,
  webhookUrl,
}: {
  credentials: ChannelCredentials;
  webhookUrl: string;
}) {
  const sns = buildSnsClient(credentials);
  const ses = buildSesClient(credentials);
  const topicArn = await resolveTopicArn(sns, SES_EVENTS_SNS_TOPIC_NAME);
  await ensureHttpsSubscription({ sns, topicArn, webhookUrl });
  await ensureConfigurationSetEvents({ ses, topicArn });
}

export async function teardownSesEventNotifications({
  credentials,
  webhookUrl,
}: {
  credentials: ChannelCredentials;
  webhookUrl: string;
}) {
  const sns = buildSnsClient(credentials);

  try {
    const topicArn = await resolveTopicArn(sns, SES_EVENTS_SNS_TOPIC_NAME);
    const subscriptions = await sns.send(
      new ListSubscriptionsByTopicCommand({ TopicArn: topicArn })
    );

    for (const subscription of subscriptions.Subscriptions ?? []) {
      if (
        subscription.Protocol === "https" &&
        subscription.Endpoint === webhookUrl &&
        subscription.SubscriptionArn &&
        subscription.SubscriptionArn !== "PendingConfirmation"
      ) {
        await sns.send(
          new UnsubscribeCommand({
            SubscriptionArn: subscription.SubscriptionArn,
          })
        );
      }
    }
  } catch (error) {
    if (!isNotFound(error)) {
      logger.warn({ error }, "Failed to teardown SES event SNS subscription");
    }
  }
}

export async function handleSesWebhook({
  rawBody,
}: {
  headers: Headers;
  rawBody: string;
}): Promise<WebhookResult> {
  const snsMessage = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      snsValidator.validate(JSON.parse(rawBody), (error, message) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(message as Record<string, unknown>);
      });
    }
  );

  if (snsMessage.Type === "SubscriptionConfirmation") {
    const subscribeUrl = snsMessage.SubscribeURL;
    if (typeof subscribeUrl === "string") {
      await fetch(subscribeUrl);
    }
    return { type: "noop" };
  }

  if (snsMessage.Type !== "Notification") {
    return { type: "noop" };
  }

  const messageBody = snsMessage.Message;
  if (typeof messageBody !== "string") {
    return { type: "noop" };
  }

  const payload = JSON.parse(messageBody) as Record<string, unknown>;

  const inbound = parseInboundReceipt(payload);
  if (inbound) {
    return inbound;
  }

  const events = parseSesEventNotification(payload);
  if (events.length > 0) {
    return { type: "events", events };
  }

  return { type: "noop" };
}
