import { env } from "@repo/api/env";
import { drizzle } from "drizzle-orm/node-postgres";
import * as authSchema from "./schema/auth";
import * as campaignSchema from "./schema/campaign";
import * as channelsSchema from "./schema/channels";
import * as contactSchema from "./schema/contact";
import * as emailSchema from "./schema/email";
import * as messageSchema from "./schema/message";
import * as providerSchema from "./schema/provider";
import * as providerRelationsSchema from "./schema/provider-relations";
import * as systemSchema from "./schema/system";
import * as templatingSchema from "./schema/templating";
import * as webhookSchema from "./schema/webhook";

export const schema = {
  ...channelsSchema,
  ...messageSchema,
  ...emailSchema,
  ...authSchema,
  ...campaignSchema,
  ...contactSchema,
  ...systemSchema,
  ...providerSchema,
  ...providerRelationsSchema,
  ...templatingSchema,
  ...webhookSchema,
};

export const db = drizzle({
  connection: {
    connectionString: env.DATABASE_URL,
    ssl: false,
  },
  schema,
});

export type DB = typeof db;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DbOrTx = DB | Transaction;

export type * from "./schema/auth";
export type * from "./schema/campaign";
export type * from "./schema/channels";
export type {
  DeliveryStatus,
  MessagePurpose,
  ProviderKind,
} from "./schema/channels";
export {
  AVAILABLE_CHANNELS,
  AVAILABLE_DELIVERY_STATUSES,
  AVAILABLE_MESSAGE_PURPOSES,
  AVAILABLE_PROVIDER_KINDS,
  ChannelTypeEnum,
  deliveryStatusEnum,
  messagePurposeEnum,
  zChannels,
} from "./schema/channels";
export type * from "./schema/contact";
export {
  AVAILABLE_CONTACT_SUPPRESSION_REASONS,
  AVAILABLE_CONTACT_SUPPRESSION_SEVERITIES,
  zContactSuppressionReason,
  zContactSuppressionSeverity,
} from "./schema/contact";
export type * from "./schema/email";
export {
  AVAILABLE_DNS_RECORD_PURPOSES,
  AVAILABLE_DNS_RECORD_TYPES,
  zDnsRecordPurpose,
  zDnsRecordType,
} from "./schema/email/domain";
export type * from "./schema/message";
export type * from "./schema/provider";
export type * from "./schema/provider-relations";
export type * from "./schema/system";
export type * from "./schema/templating";
export {
  AVAILABLE_TEMPLATE_CHANNEL_ENGINES,
  AVAILABLE_TEMPLATING_WORKSPACE_KINDS,
  AVAILABLE_TEMPLATING_WORKSPACE_SOURCES,
  zTemplateChannelEngine,
  zTemplatingWorkspaceKind,
  zTemplatingWorkspaceSource,
} from "./schema/templating";
export type * from "./schema/webhook";
export {
  AVAILABLE_WEBHOOK_DELIVERY_STATUSES,
  webhookDeliveryStatusEnum,
} from "./schema/webhook";
