import * as NodeFS from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { namesFor, SES_CONFIGURATION_SET_NAME } from "./email/infrastructure";
import { sesTenantNameFor } from "./email/tenant-name";
import { AWS_OPERATIONS } from "./operations";

const POLICY_FILE = new URL("../../../docs/aws-ses-iam-policy.json", import.meta.url);

/** The policy as the file has it: `ACCOUNT_ID` stands for the deployment's account. */
const policy: {
  readonly Statement: readonly {
    readonly Action: string | readonly string[];
    readonly Effect: string;
    readonly Resource: string | readonly string[];
  }[];
} = JSON.parse(NodeFS.readFileSync(POLICY_FILE, "utf8"));

const grants = policy.Statement.flatMap((statement) =>
  [statement.Action]
    .flat()
    .flatMap((action) => [statement.Resource].flat().map((resource) => ({ action, resource }))),
);

const names = namesFor("https://api.example.com/webhooks/providers/aws/ses");
const ses = (resource: string) => `arn:aws:ses:eu-central-1:ACCOUNT_ID:${resource}`;
const identity = ses("identity/example.com");
const configurationSet = ses(`configuration-set/${SES_CONFIGURATION_SET_NAME}`);
// `tenant/{tenant name}/{tenant id}`
const tenant = ses(`tenant/${sesTenantNameFor("orgn_01jz")}/tn-0123456789abcdef`);
const topic = `arn:aws:sns:eu-central-1:ACCOUNT_ID:${names.topicName}`;
const rule = `arn:aws:events:eu-central-1:ACCOUNT_ID:rule/${names.tenantStatusRuleName}`;

/**
 * Each operation's IAM action is its name (`ses:SendEmail`), and these are the resources the
 * backend calls it on, named as the code names them. An association is authorized on the
 * tenant and on what is attached to it. `*` is an action IAM gives no resource to name.
 */
const USES = {
  events: { putRule: [rule], putTargets: [rule] },
  ses: {
    createConfigurationSet: [configurationSet],
    createConfigurationSetEventDestination: [configurationSet],
    createEmailIdentity: [identity],
    createTenant: [tenant],
    createTenantResourceAssociation: [tenant, identity, configurationSet],
    deleteEmailIdentity: [identity],
    deleteTenantResourceAssociation: [tenant, identity],
    getEmailIdentity: [identity],
    getReputationEntity: [tenant],
    getTenant: [tenant],
    listResourceTenants: [identity],
    listTenants: ["*"],
    putEmailIdentityMailFromAttributes: [identity],
    sendEmail: [identity, configurationSet],
    updateConfigurationSetEventDestination: [configurationSet],
  },
  sns: {
    createTopic: [topic],
    getTopicAttributes: [topic],
    listSubscriptionsByTopic: [topic],
    setTopicAttributes: [topic],
    subscribe: [topic],
  },
} satisfies {
  readonly [Service in keyof typeof AWS_OPERATIONS]: Record<
    (typeof AWS_OPERATIONS)[Service][number],
    readonly string[]
  >;
};

const uses = Object.entries(USES).flatMap(([service, operations]) =>
  Object.entries(operations).flatMap(([operation, resources]) =>
    resources.map((resource) => ({
      action: `${service}:${operation[0]?.toUpperCase()}${operation.slice(1)}`,
      resource,
    })),
  ),
);

/** Whether an IAM resource pattern (`*` and `?` wildcards) covers a resource. */
const covers = (pattern: string, resource: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  ).test(resource);

describe("docs/aws-ses-iam-policy.json", () => {
  it("only allows", () => {
    expect(policy.Statement.map((statement) => statement.Effect)).toEqual(
      policy.Statement.map(() => "Allow"),
    );
  });

  it("allows every call the backend makes, on the resource it makes it on", () => {
    expect(
      uses.filter(
        (use) =>
          !grants.some(
            (grant) => grant.action === use.action && covers(grant.resource, use.resource),
          ),
      ),
    ).toEqual([]);
  });

  it("allows nothing the backend does not call, and names no resource it does not use", () => {
    expect(
      grants.filter(
        (grant) =>
          !uses.some(
            (use) =>
              use.action === grant.action &&
              // A `*` grant is only for an action that takes no resource.
              (use.resource === "*"
                ? grant.resource === "*"
                : grant.resource !== "*" && covers(grant.resource, use.resource)),
          ),
      ),
    ).toEqual([]);
  });

  // The types refuse a call to an operation that is not listed; this refuses a listed one
  // nothing calls any more, which the policy would go on granting.
  it("lists no operation the backend has stopped calling", () => {
    const emailDir = new URL("./email/", import.meta.url);
    const source = NodeFS.readdirSync(emailDir)
      .filter((file) => file.endsWith(".ts") && !file.includes(".test.") && !file.includes("fake"))
      .map((file) => NodeFS.readFileSync(new URL(file, emailDir), "utf8"))
      .join("\n");
    expect(
      Object.values(AWS_OPERATIONS)
        .flat()
        .filter((operation) => !new RegExp(`\\.\\s*${operation}\\(`).test(source)),
    ).toEqual([]);
  });
});
