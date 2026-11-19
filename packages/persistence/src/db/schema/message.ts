import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organizationAppEnvironment } from "./auth";
import { messagePurposeEnum } from "./channels";
import { topic } from "./contact";
import { template } from "./templating/template";

/**
 * Channel-agnostic logical send (Message). Channel Format + Delivery status live
 * on per-channel Delivery rows (e.g. `emailDelivery`).
 */
export const message = pgTable(
  "message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("msg").toString()),
    organizationAppEnvironmentId: text("organization_app_environment_id")
      .notNull()
      .references(() => organizationAppEnvironment.id, { onDelete: "cascade" }),
    purpose: messagePurposeEnum("purpose").notNull(),
    /**
     * The Topic a marketing Message is sent under: whose Unsubscribes stop it, and what its
     * List-Unsubscribe link opts out of. Null for a transactional one. A deleted Topic takes
     * its Unsubscribes with it, so a Message that outlives it is held only to the opt-out of
     * all marketing, and goes out without a List-Unsubscribe link, which needs a Topic.
     */
    topicId: text("topic_id").references(() => topic.id, { onDelete: "set null" }),
    templateId: text("template_id").references(() => template.id, {
      onDelete: "set null",
    }),
    /** Caller-supplied Message Tags (key/value); immutable after Accept. */
    tags: jsonb("tags").$type<Record<string, string>>(),
    scheduledAt: timestamp("scheduled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("message_app_environment_created_idx").on(t.organizationAppEnvironmentId, t.createdAt),
    index("message_template_idx").on(t.templateId),
    // For the foreign key: removing a Topic, as removing its Project does, looks up the
    // Messages sent under it. Only marketing Messages have one.
    index("message_topic_idx")
      .on(t.topicId)
      .where(sql`${t.topicId} IS NOT NULL`),
  ],
);

export type Message = typeof message.$inferSelect;
export type MessageInsert = typeof message.$inferInsert;
