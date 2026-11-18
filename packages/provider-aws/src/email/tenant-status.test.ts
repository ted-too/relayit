import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { sesTenantNameFor } from "./tenant-name";
import {
  ensureSesTenantStatusEvents,
  isEventBridgeEvent,
  projectOfTenantStatusEvent,
} from "./tenant-status";
import {
  TENANT_STATUS_EVENTS,
  TENANT_STATUS_EVENTS_TOPIC,
  tenantStatusEventFor,
} from "./tenant-status.fixtures";

const PROJECT_ID = "orgn_01k53s8sz5ecvvtqrh902mrhfc";

describe("isEventBridgeEvent", () => {
  it("tells SES's tenant status events from its notifications", () => {
    for (const event of Object.values(TENANT_STATUS_EVENTS)) {
      expect(isEventBridgeEvent(event)).toBe(true);
    }
    // What the configuration set publishes, and SES's older notification shape.
    const mail = { destination: ["to@example.com"], messageId: "ses-message-id" };
    expect(isEventBridgeEvent({ bounce: {}, eventType: "Bounce", mail })).toBe(false);
    expect(isEventBridgeEvent({ mail, notificationType: "Delivery" })).toBe(false);
    // An SES notification stays one whatever else it carries.
    expect(
      isEventBridgeEvent({ ...TENANT_STATUS_EVENTS.disabled, eventType: "Bounce", mail }),
    ).toBe(false);
    expect(isEventBridgeEvent({})).toBe(false);
  });
});

describe("projectOfTenantStatusEvent", () => {
  it("names the Project and region of a Relayit tenant, whatever status the event reports", () => {
    for (const event of Object.values(TENANT_STATUS_EVENTS)) {
      expect(
        projectOfTenantStatusEvent(
          tenantStatusEventFor(event, sesTenantNameFor(PROJECT_ID)),
          TENANT_STATUS_EVENTS_TOPIC,
        ),
      ).toEqual({ projectId: PROJECT_ID, region: "eu-central-1" });
    }
    // The observed tenant was named like Relayit's without being a Project's: only the
    // lookup of the Project can tell.
    expect(
      projectOfTenantStatusEvent(TENANT_STATUS_EVENTS.disabled, TENANT_STATUS_EVENTS_TOPIC),
    ).toEqual({ projectId: "evtest-1795008081", region: "eu-central-1" });
  });

  it("ignores a tenant that is not named as Relayit names them", () => {
    for (const tenantName of ["acme-production", "relayit-", "relayit"]) {
      expect(
        projectOfTenantStatusEvent(
          tenantStatusEventFor(TENANT_STATUS_EVENTS.disabled, tenantName),
          TENANT_STATUS_EVENTS_TOPIC,
        ),
      ).toBeUndefined();
    }
  });

  it("ignores an event from another account or region than the topic it arrived on", () => {
    const event = tenantStatusEventFor(TENANT_STATUS_EVENTS.disabled, sesTenantNameFor(PROJECT_ID));
    expect(
      projectOfTenantStatusEvent(event, "arn:aws:sns:eu-central-1:999999999999:relayit-delivery-x"),
    ).toBeUndefined();
    expect(
      projectOfTenantStatusEvent(event, "arn:aws:sns:us-east-1:123456789012:relayit-delivery-x"),
    ).toBeUndefined();
    // The envelope agrees with the topic and the tenant named is someone else's.
    expect(
      projectOfTenantStatusEvent(
        {
          ...event,
          resources: [
            `arn:aws:ses:eu-central-1:999999999999:tenant/${sesTenantNameFor(PROJECT_ID)}/tn-1`,
          ],
        },
        TENANT_STATUS_EVENTS_TOPIC,
      ),
    ).toBeUndefined();
    expect(projectOfTenantStatusEvent(event, "not an arn")).toBeUndefined();
  });

  it("ignores every other event", () => {
    const event = tenantStatusEventFor(TENANT_STATUS_EVENTS.disabled, sesTenantNameFor(PROJECT_ID));
    for (const other of [
      { ...event, "detail-type": "Advisor Recommendation Status Open" },
      { ...event, source: "aws.health" },
      { ...event, source: "relayit.forged" },
      { ...event, resources: ["arn:aws:ses:eu-central-1:123456789012:identity/example.com"] },
      {
        ...event,
        resources: [
          `arn:aws:ses:eu-central-1:123456789012:tenant/${sesTenantNameFor(PROJECT_ID)}/tn-1/x`,
        ],
      },
      { ...event, resources: [] },
      { ...event, resources: "arn:aws:ses" },
    ]) {
      expect(projectOfTenantStatusEvent(other, TENANT_STATUS_EVENTS_TOPIC)).toBeUndefined();
    }
  });
});

const RULE_NAME = "relayit-tenant-status-0badc0de";
const RULE_ARN = `arn:aws:events:eu-central-1:123456789012:rule/${RULE_NAME}`;

/** What SNS gives a new topic, which is what lets SES publish its notifications. */
const DEFAULT_STATEMENT = {
  Action: ["SNS:Publish", "SNS:Subscribe"],
  Condition: { StringEquals: { "AWS:SourceAccount": "123456789012" } },
  Effect: "Allow",
  Principal: { AWS: "*" },
  Resource: TENANT_STATUS_EVENTS_TOPIC,
  Sid: "__default_statement_ID",
};

const DEFAULT_POLICY = JSON.stringify({
  Id: "__default_policy_ID",
  Statement: [DEFAULT_STATEMENT],
  Version: "2012-10-17",
});

/** EventBridge and SNS in one region, the topic holding `policy` (none when `null`). */
const fakeAws = (
  initialPolicy: string | null = DEFAULT_POLICY,
  fail: Partial<Record<"getTopicAttributes" | "putRule" | "putTargets", unknown>> = {},
) => {
  let policy = initialPolicy;
  const rules: { EventPattern?: string; Name?: string; State?: string }[] = [];
  const targets = new Map<string, string>();
  const written: { AttributeName: string; AttributeValue: string }[] = [];
  const ensure = ensureSesTenantStatusEvents({
    events: {
      putRule: (input: (typeof rules)[number]) => {
        rules.push(input);
        return fail.putRule ? Effect.fail(fail.putRule) : Effect.succeed({ RuleArn: RULE_ARN });
      },
      putTargets: ({ Rule, Targets }: { Rule: string; Targets: { Arn: string; Id: string }[] }) => {
        if (fail.putTargets) {
          return Effect.fail(fail.putTargets);
        }
        for (const target of Targets) {
          targets.set(`${Rule}:${target.Id}`, target.Arn);
        }
        return Effect.succeed({ FailedEntryCount: 0 });
      },
    } as unknown as Parameters<typeof ensureSesTenantStatusEvents>[0]["events"],
    sns: {
      getTopicAttributes: () =>
        fail.getTopicAttributes
          ? Effect.fail(fail.getTopicAttributes)
          : Effect.succeed({ Attributes: policy === null ? {} : { Policy: policy } }),
      setTopicAttributes: (input: { AttributeName: string; AttributeValue: string }) => {
        written.push(input);
        policy = input.AttributeValue;
        return Effect.succeed({});
      },
    } as unknown as Parameters<typeof ensureSesTenantStatusEvents>[0]["sns"],
    tenantStatusRuleName: RULE_NAME,
    topicArn: TENANT_STATUS_EVENTS_TOPIC,
  });
  return { ensure, policy: () => JSON.parse(policy ?? "null"), rules, targets, written };
};

describe("ensureSesTenantStatusEvents", () => {
  it.effect("makes the rule, lets EventBridge publish to the topic, and targets it", () =>
    Effect.gen(function* () {
      const { ensure, policy, rules, targets } = fakeAws();
      yield* ensure;

      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ Name: RULE_NAME, State: "ENABLED" });
      // The default bus: no `EventBusName`.
      expect(rules[0]).not.toHaveProperty("EventBusName");
      expect(JSON.parse(rules[0]?.EventPattern ?? "")).toEqual({
        "detail-type": ["Sending Status Enabled", "Sending Status Disabled"],
        resources: [{ prefix: "arn:aws:ses:eu-central-1:123456789012:tenant/relayit-" }],
        source: ["aws.ses"],
      });
      expect([...targets]).toEqual([
        [`${RULE_NAME}:relayit-ses-notifications`, TENANT_STATUS_EVENTS_TOPIC],
      ]);
      // What was in the policy is still there, untouched, beside the new statement.
      expect(policy()).toEqual({
        Id: "__default_policy_ID",
        Statement: [
          DEFAULT_STATEMENT,
          {
            Action: "sns:Publish",
            Condition: { ArnEquals: { "aws:SourceArn": RULE_ARN } },
            Effect: "Allow",
            Principal: { Service: "events.amazonaws.com" },
            Resource: TENANT_STATUS_EVENTS_TOPIC,
            Sid: "RelayitTenantStatusEvents",
          },
        ],
        Version: "2012-10-17",
      });
    }),
  );

  it.effect("changes nothing on a second start", () =>
    Effect.gen(function* () {
      const { ensure, policy, rules, targets, written } = fakeAws();
      yield* ensure;
      const after = policy();
      yield* ensure;

      // The policy is written once; the rule and target are put again with the same values.
      expect(written).toHaveLength(1);
      expect(policy()).toEqual(after);
      expect(policy().Statement).toHaveLength(2);
      expect(rules[1]).toEqual(rules[0]);
      expect(targets.size).toBe(1);
    }),
  );

  it.effect("leaves the statement alone as SNS spells it back, and replaces a stale one", () =>
    Effect.gen(function* () {
      const statement = (ruleArn: string) => ({
        Action: "SNS:Publish",
        Condition: { ArnEquals: { "aws:SourceArn": ruleArn } },
        Effect: "Allow",
        Principal: { Service: "events.amazonaws.com" },
        Resource: TENANT_STATUS_EVENTS_TOPIC,
        Sid: "RelayitTenantStatusEvents",
      });
      const current = fakeAws(
        JSON.stringify({ Statement: [DEFAULT_STATEMENT, statement(RULE_ARN)] }),
      );
      yield* current.ensure;
      expect(current.written).toEqual([]);

      const stale = fakeAws(
        JSON.stringify({
          Statement: [
            statement("arn:aws:events:eu-central-1:123456789012:rule/old"),
            DEFAULT_STATEMENT,
          ],
        }),
      );
      yield* stale.ensure;
      expect(stale.policy().Statement).toEqual([
        DEFAULT_STATEMENT,
        { ...statement(RULE_ARN), Action: "sns:Publish" },
      ]);
    }),
  );

  it.effect("keeps a policy's only statement when IAM's single-object form holds it", () =>
    Effect.gen(function* () {
      // Valid IAM: `Statement` may be one statement instead of a list of them.
      const { ensure, policy, targets } = fakeAws(
        JSON.stringify({ Statement: DEFAULT_STATEMENT, Version: "2012-10-17" }),
      );
      yield* ensure;

      expect(policy().Statement).toEqual([
        DEFAULT_STATEMENT,
        expect.objectContaining({ Sid: "RelayitTenantStatusEvents" }),
      ]);
      expect(targets.size).toBe(1);
    }),
  );

  it.effect("does not replace a policy it cannot read whole", () =>
    Effect.gen(function* () {
      for (const unreadable of [
        null,
        "",
        "not json",
        "[]",
        // No statements, or statements that are not what IAM allows there.
        JSON.stringify({ Version: "2012-10-17" }),
        JSON.stringify({ Statement: "Allow" }),
        JSON.stringify({ Statement: null }),
        JSON.stringify({ Statement: [DEFAULT_STATEMENT, "Allow"] }),
        JSON.stringify({ Statement: [[DEFAULT_STATEMENT]] }),
      ]) {
        const { ensure, targets, written } = fakeAws(unreadable);
        yield* ensure;
        expect(written).toEqual([]);
        // Nothing may publish, so nothing is targeted.
        expect(targets.size).toBe(0);
      }
    }),
  );

  it.effect("never fails the worker's start, whichever step the account refuses", () =>
    Effect.gen(function* () {
      // An IAM policy from before `events:*` and `sns:GetTopicAttributes` were needed.
      const denied = { _tag: "AccessDeniedException" };
      for (const step of ["putRule", "getTopicAttributes", "putTargets"] as const) {
        const { ensure, targets } = fakeAws(DEFAULT_POLICY, { [step]: denied });
        yield* ensure;
        expect(targets.size).toBe(0);
      }
    }),
  );
});
