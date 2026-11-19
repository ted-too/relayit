import type { EventBridge } from "@effect-aws/client-eventbridge";
import type { SESv2 } from "@effect-aws/client-sesv2";
import type { SNS } from "@effect-aws/client-sns";

/**
 * Every operation the backend calls with the `SES_*` credentials. The clients the backend
 * is given have these and no others, so a call to one not listed here does not typecheck,
 * and `policy.test.ts` holds `docs/aws-ses-iam-policy.json` to this list: add an operation
 * here and the policy has to grant it, in the same change. STS `GetCallerIdentity`, which
 * the api also calls, needs no permission and is not here.
 */
export const AWS_OPERATIONS = {
  events: ["putRule", "putTargets"],
  ses: [
    "createConfigurationSet",
    "createConfigurationSetEventDestination",
    "createEmailIdentity",
    "createTenant",
    "createTenantResourceAssociation",
    "deleteEmailIdentity",
    "deleteTenantResourceAssociation",
    "getEmailIdentity",
    "getReputationEntity",
    "getTenant",
    "listResourceTenants",
    "listTenants",
    "putEmailIdentityMailFromAttributes",
    "sendEmail",
    "updateConfigurationSetEventDestination",
  ],
  sns: [
    "createTopic",
    "getTopicAttributes",
    "listSubscriptionsByTopic",
    "setTopicAttributes",
    "subscribe",
  ],
} as const satisfies {
  events: readonly (keyof EventBridge.Type)[];
  ses: readonly (keyof SESv2.Type)[];
  sns: readonly (keyof SNS.Type)[];
};

export type EventsOperation = (typeof AWS_OPERATIONS.events)[number];
export type SesOperation = (typeof AWS_OPERATIONS.ses)[number];
export type SnsOperation = (typeof AWS_OPERATIONS.sns)[number];

export type EventsClient = Pick<EventBridge.Type, EventsOperation>;
export type SesClient = Pick<SESv2.Type, SesOperation>;
export type SnsClient = Pick<SNS.Type, SnsOperation>;
