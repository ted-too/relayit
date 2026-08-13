import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import type { EmailFrom } from "../validators/channels/email";
import { organization } from "./auth";
import { channelEnum } from "./channels";
import { topic } from "./contact";
import { template } from "./templating/template";

/**
 * Project-scoped marketing Campaign definition. Soft-archived via `archivedAt`.
 * Name is required for humans/UI but not unique — APIs address Campaigns by id.
 * Content is always a Template; per-channel Froms live on `campaignChannelFrom`.
 */
export const campaign = pgTable(
  "campaign",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("camp").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "restrict" }),
    templateId: text("template_id")
      .notNull()
      .references(() => template.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("campaign_organization_idx").on(t.organizationId),
    index("campaign_topic_idx").on(t.topicId),
    index("campaign_template_idx").on(t.templateId),
    index("campaign_archived_at_idx").on(t.archivedAt),
    index("campaign_organization_name_idx").on(t.organizationId, t.name),
  ]
);

export type Campaign = typeof campaign.$inferSelect;

/** Per-channel sending identity on a Campaign (email first). */
export const campaignChannelFrom = pgTable(
  "campaign_channel_from",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ccfr").toString()),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    from: jsonb("from").$type<EmailFrom>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("campaign_channel_from_campaign_channel_uidx").on(
      t.campaignId,
      t.channel
    ),
  ]
);

export type CampaignChannelFrom = typeof campaignChannelFrom.$inferSelect;
