import type { EventBridge } from "@effect-aws/client-eventbridge";
import type { SNS } from "@effect-aws/client-sns";
import { Effect, Schema } from "effect";
import { AwsTenantStatusEventsError } from "../errors";
import { projectIdFromSesTenantName, SES_TENANT_NAME_PREFIX } from "./tenant-name";

/**
 * What SES puts on the account's default event bus when one of a tenant's two statuses
 * changes. `Sending Status Enabled` covers both `ENABLED` and `REINSTATED`.
 */
const TENANT_STATUS_DETAIL_TYPES = ["Sending Status Enabled", "Sending Status Disabled"];
const SES_EVENT_SOURCE = "aws.ses";

const POLICY_STATEMENT_SID = "RelayitTenantStatusEvents";
const TARGET_ID = "relayit-ses-notifications";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/** `arn:{partition}:{service}:{region}:{account}:{resource}`, the resource kept whole. */
const arnParts = (arn: string) => {
  const [prefix, partition, service, region, account, ...resource] = arn.split(":");
  return prefix === "arn" && partition && service && region && account && resource.length > 0
    ? { account, partition, region, resource: resource.join(":"), service }
    : undefined;
};

/**
 * Whether a message on the notification topic is an EventBridge event and not one of SES's
 * own notifications. EventBridge publishes the whole event as the SNS message, so it has the
 * envelope's `detail-type` and `source`; an SES notification names its kind in `eventType`
 * (or `notificationType`), which an event never has at its top level.
 */
export const isEventBridgeEvent = (payload: Record<string, unknown>) =>
  typeof payload["detail-type"] === "string" &&
  typeof payload.source === "string" &&
  payload.eventType === undefined &&
  payload.notificationType === undefined;

/**
 * The Project and region an EventBridge event says to look at again, or nothing when it is
 * not a sending-status event for a tenant named as Relayit names them, in the account and
 * region of the topic it arrived on. Nothing of the status it reports is read: events arrive
 * late, twice and out of order, and each tells of one of the tenant's two statuses only, so
 * an event is only a reason to ask SES what the tenant's status is now.
 */
export const projectOfTenantStatusEvent = (payload: Record<string, unknown>, topicArn: string) => {
  const topic = arnParts(topicArn);
  if (
    !topic ||
    payload.source !== SES_EVENT_SOURCE ||
    typeof payload["detail-type"] !== "string" ||
    !TENANT_STATUS_DETAIL_TYPES.includes(payload["detail-type"]) ||
    payload.account !== topic.account ||
    payload.region !== topic.region ||
    !Array.isArray(payload.resources)
  ) {
    return;
  }
  for (const resource of payload.resources) {
    const tenant = typeof resource === "string" ? arnParts(resource) : undefined;
    // `tenant/{tenant name}/{tenant id}`
    const [kind, tenantName, tenantId, ...rest] = tenant?.resource.split("/") ?? [];
    if (
      tenant?.service !== "ses" ||
      tenant.partition !== topic.partition ||
      tenant.account !== topic.account ||
      tenant.region !== topic.region ||
      kind !== "tenant" ||
      !tenantName ||
      !tenantId ||
      rest.length > 0
    ) {
      continue;
    }
    const projectId = projectIdFromSesTenantName(tenantName);
    if (projectId) {
      return { projectId, region: topic.region };
    }
  }
};

/** The rule's pattern: the sending-status events of this account's Relayit tenants here. */
const tenantStatusEventPattern = (topic: NonNullable<ReturnType<typeof arnParts>>) => ({
  "detail-type": TENANT_STATUS_DETAIL_TYPES,
  resources: [
    {
      prefix: `arn:${topic.partition}:ses:${topic.region}:${topic.account}:tenant/${SES_TENANT_NAME_PREFIX}`,
    },
  ],
  source: [SES_EVENT_SOURCE],
});

const decodeTopicPolicy = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/**
 * The topic's policy with the statement that lets EventBridge publish this rule's events:
 * `unchanged` when it is already there, `unreadable` when the policy's statements are not
 * what IAM allows there (one statement, or a list of them). Every other statement is kept
 * as it is: the default one is what lets SES publish its notifications, so a policy this
 * cannot read whole is never written back.
 */
const withTenantStatusStatement = (
  policy: Record<string, unknown>,
  input: { readonly ruleArn: string; readonly topicArn: string },
) => {
  const statement = {
    Action: "sns:Publish",
    Condition: { ArnEquals: { "aws:SourceArn": input.ruleArn } },
    Effect: "Allow",
    Principal: { Service: "events.amazonaws.com" },
    Resource: input.topicArn,
    Sid: POLICY_STATEMENT_SID,
  };
  const statements = (Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement]).map(
    (item: unknown) => (Array.isArray(item) ? undefined : asRecord(item)),
  );
  if (statements.includes(undefined)) {
    return { kind: "unreadable" } as const;
  }
  const current = statements.find((item) => item?.Sid === POLICY_STATEMENT_SID);
  if (
    current &&
    current.Effect === statement.Effect &&
    // SNS answers with the action's service in capitals.
    String(current.Action).toLowerCase() === statement.Action.toLowerCase() &&
    current.Resource === statement.Resource &&
    asRecord(current.Principal)?.Service === statement.Principal.Service &&
    asRecord(asRecord(current.Condition)?.ArnEquals)?.["aws:SourceArn"] === input.ruleArn
  ) {
    return { kind: "unchanged" } as const;
  }
  return {
    kind: "changed",
    policy: {
      ...policy,
      Statement: [...statements.filter((item) => item?.Sid !== POLICY_STATEMENT_SID), statement],
    },
  } as const;
};

/**
 * Has SES's tenant sending-status events reach the api: a rule on the default event bus
 * whose target is the notification topic, and the statement in the topic's policy that lets
 * EventBridge publish there. Named after the webhook URL like the topic, and every step
 * writes the same value again, so a restart changes nothing.
 *
 * Sending does not depend on it, so it never fails the worker's start: a deployment whose
 * IAM policy predates these permissions is told, and still learns of a Project Sending Pause
 * from the next send that hits it.
 */
export const ensureSesTenantStatusEvents = ({
  events,
  sns,
  tenantStatusRuleName,
  topicArn,
}: {
  events: Pick<EventBridge.Type, "putRule" | "putTargets">;
  sns: Pick<SNS.Type, "getTopicAttributes" | "setTopicAttributes">;
  tenantStatusRuleName: string;
  topicArn: string;
}) =>
  Effect.gen(function* () {
    const topic = arnParts(topicArn);
    if (!topic) {
      return yield* new AwsTenantStatusEventsError({ reason: "topic_arn_unreadable" });
    }
    const rule = yield* events.putRule({
      Description: "SES tenant sending-status changes, for Relayit's api",
      EventPattern: JSON.stringify(tenantStatusEventPattern(topic)),
      Name: tenantStatusRuleName,
      State: "ENABLED",
    });
    if (!rule.RuleArn) {
      return yield* new AwsTenantStatusEventsError({ reason: "rule_arn_missing" });
    }

    // Before the target, so EventBridge may publish from the first event it matches.
    const attributes = yield* sns.getTopicAttributes({ TopicArn: topicArn });
    const current = yield* decodeTopicPolicy(attributes.Attributes?.Policy ?? "").pipe(
      // A policy that cannot be read is not replaced: the statements in it would be lost.
      Effect.mapError(
        (cause) => new AwsTenantStatusEventsError({ cause, reason: "topic_policy_unreadable" }),
      ),
    );
    const merged = withTenantStatusStatement(current, { ruleArn: rule.RuleArn, topicArn });
    if (merged.kind === "unreadable") {
      return yield* new AwsTenantStatusEventsError({ reason: "topic_policy_unreadable" });
    }
    if (merged.kind === "changed") {
      yield* sns.setTopicAttributes({
        AttributeName: "Policy",
        AttributeValue: JSON.stringify(merged.policy),
        TopicArn: topicArn,
      });
    }

    const targets = yield* events.putTargets({
      Rule: tenantStatusRuleName,
      Targets: [{ Arn: topicArn, Id: TARGET_ID }],
    });
    if (targets.FailedEntryCount) {
      return yield* new AwsTenantStatusEventsError({
        cause: targets.FailedEntries,
        reason: "target_refused",
      });
    }
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning(
        "Failed to set up SES tenant sending-status events; a Project Sending Pause is noticed only when a send hits it, and its Domains stay paused until an admin unpauses them. The SES IAM policy needs events:PutRule, events:PutTargets, sns:GetTopicAttributes and sns:SetTopicAttributes (docs/aws-ses-iam-policy.json)",
        { cause, tenantStatusRuleName, topicArn },
      ),
    ),
  );
