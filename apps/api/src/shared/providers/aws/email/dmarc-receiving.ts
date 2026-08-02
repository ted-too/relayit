import {
  CreateReceiptRuleCommand,
  CreateReceiptRuleSetCommand,
  DescribeReceiptRuleSetCommand,
  SESClient,
  SetActiveReceiptRuleSetCommand,
} from "@aws-sdk/client-ses";
import { CreateTopicCommand, SubscribeCommand } from "@aws-sdk/client-sns";
import type { ChannelCredentials } from "@repo/api/channels/base";
import { getDmarcReportDomain } from "@repo/api/channels/email/deliverability/dmarc";
import { getUnsubscribeInboundDomain } from "@repo/api/channels/email/unsubscribe";
import { requireCloudflareEnv } from "@repo/api/env";
import { logger } from "@repo/api/utils";
import Cloudflare from "cloudflare";
import { awsSesRegion, buildAwsSdkConfig, buildSnsClient } from "./clients";

export const DMARC_INBOUND_SNS_TOPIC_NAME = "relayit-dmarc-inbound";
export const DMARC_RECEIPT_RULE_SET_NAME = "relayit-dmarc-inbound";
export const DMARC_RECEIPT_RULE_NAME = "relayit-dmarc-inbound-rule";
export const UNSUBSCRIBE_RECEIPT_RULE_NAME = "relayit-unsubscribe-inbound-rule";

function isAlreadyExists(error: unknown) {
  return (error as { name?: string }).name === "AlreadyExistsException";
}

async function buildSesInboundClient(credentials: ChannelCredentials) {
  return new SESClient(await buildAwsSdkConfig(credentials));
}

const TRAILING_SLASH_RE = /\/$/;

export function dmarcInboundWebhookUrl(apiUrl: string) {
  return `${apiUrl.replace(TRAILING_SLASH_RE, "")}/webhooks/providers/aws/ses`;
}

export async function ensureDmarcInboundReceiving({
  credentials,
  webhookUrl,
}: {
  credentials: ChannelCredentials;
  webhookUrl: string;
}) {
  const sns = await buildSnsClient(credentials);
  const ses = await buildSesInboundClient(credentials);
  const dmarcReportDomain = getDmarcReportDomain();

  const topicResult = await sns.send(
    new CreateTopicCommand({ Name: DMARC_INBOUND_SNS_TOPIC_NAME })
  );
  const topicArn = topicResult.TopicArn;
  if (!topicArn) {
    throw new Error("Failed to create DMARC inbound SNS topic");
  }

  await sns.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "https",
      Endpoint: webhookUrl,
      ReturnSubscriptionArn: true,
    })
  );

  try {
    await ses.send(
      new CreateReceiptRuleSetCommand({
        RuleSetName: DMARC_RECEIPT_RULE_SET_NAME,
      })
    );
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
  }

  await ses.send(
    new SetActiveReceiptRuleSetCommand({
      RuleSetName: DMARC_RECEIPT_RULE_SET_NAME,
    })
  );

  const existingRuleSet = await ses.send(
    new DescribeReceiptRuleSetCommand({
      RuleSetName: DMARC_RECEIPT_RULE_SET_NAME,
    })
  );

  const hasRule = existingRuleSet.Rules?.some(
    (rule) => rule.Name === DMARC_RECEIPT_RULE_NAME
  );

  if (!hasRule) {
    await ses.send(
      new CreateReceiptRuleCommand({
        RuleSetName: DMARC_RECEIPT_RULE_SET_NAME,
        Rule: {
          Name: DMARC_RECEIPT_RULE_NAME,
          Enabled: true,
          Recipients: [dmarcReportDomain],
          Actions: [
            {
              SNSAction: {
                TopicArn: topicArn,
                Encoding: "Base64",
              },
            },
          ],
        },
      })
    );
  }
}

export async function ensureInboundMxRecord({
  domain,
  region,
}: {
  domain: string;
  region: string;
}) {
  const cf = requireCloudflareEnv();
  const cloudflare = new Cloudflare({ apiToken: cf.apiToken });
  const mxValue = `inbound-smtp.${region}.amazonaws.com`;

  const existing = await cloudflare.dns.records.list({
    zone_id: cf.zoneId,
    name: { exact: domain },
    type: "MX",
  });

  const match = existing.result?.find(
    (record) => record.type === "MX" && record.content === mxValue
  );

  if (match) {
    return;
  }

  await cloudflare.dns.records.create({
    zone_id: cf.zoneId,
    type: "MX",
    name: domain,
    content: mxValue,
    priority: 10,
    ttl: 300,
  });
}

export async function ensureDmarcReportMxRecord({
  region,
}: {
  region: string;
}) {
  await ensureInboundMxRecord({ domain: getDmarcReportDomain(), region });
}

async function resolveInboundTopicArn(
  sns: Awaited<ReturnType<typeof buildSnsClient>>
) {
  const topicResult = await sns.send(
    new CreateTopicCommand({ Name: DMARC_INBOUND_SNS_TOPIC_NAME })
  );
  const topicArn = topicResult.TopicArn;
  if (!topicArn) {
    throw new Error("Failed to resolve inbound SNS topic");
  }
  return topicArn;
}

async function ensureInboundReceiptRule({
  credentials,
  ruleName,
  recipients,
  topicArn,
}: {
  credentials: ChannelCredentials;
  ruleName: string;
  recipients: string[];
  topicArn: string;
}) {
  const ses = await buildSesInboundClient(credentials);

  const existingRuleSet = await ses.send(
    new DescribeReceiptRuleSetCommand({
      RuleSetName: DMARC_RECEIPT_RULE_SET_NAME,
    })
  );

  const hasRule = existingRuleSet.Rules?.some((rule) => rule.Name === ruleName);
  if (hasRule) {
    return;
  }

  await ses.send(
    new CreateReceiptRuleCommand({
      RuleSetName: DMARC_RECEIPT_RULE_SET_NAME,
      Rule: {
        Name: ruleName,
        Enabled: true,
        Recipients: recipients,
        Actions: [
          {
            SNSAction: {
              TopicArn: topicArn,
              Encoding: "Base64",
            },
          },
        ],
      },
    })
  );
}

export async function ensureUnsubscribeInboundReceiving({
  credentials,
}: {
  credentials: ChannelCredentials;
}) {
  const region = await awsSesRegion(credentials);
  const unsubscribeInboundDomain = getUnsubscribeInboundDomain();
  await ensureInboundMxRecord({ domain: unsubscribeInboundDomain, region });

  const sns = await buildSnsClient(credentials);
  const topicArn = await resolveInboundTopicArn(sns);

  await ensureInboundReceiptRule({
    credentials,
    ruleName: UNSUBSCRIBE_RECEIPT_RULE_NAME,
    recipients: [unsubscribeInboundDomain],
    topicArn,
  });
}

export async function bootstrapDmarcReceiving({
  credentials,
  webhookUrl,
}: {
  credentials: ChannelCredentials;
  webhookUrl: string;
}) {
  try {
    await ensureDmarcReportMxRecord({
      region: await awsSesRegion(credentials),
    });
    await ensureDmarcInboundReceiving({ credentials, webhookUrl });
    await ensureUnsubscribeInboundReceiving({ credentials });
  } catch (error) {
    logger.error({ error }, "Failed to bootstrap DMARC inbound receiving");
    throw error;
  }
}
