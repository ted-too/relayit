import { relations, sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organizationAppEnvironment } from "./auth";
import { messagePurposeEnum } from "./channels";
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
    templateId: text("template_id").references(() => template.id, {
      onDelete: "set null",
    }),
    /** Caller-supplied Message Tags (key/value); immutable after Accept. */
    tags: jsonb("tags").$type<Record<string, string>>(),
    idempotencyKey: text("idempotency_key"),
    scheduledAt: timestamp("scheduled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("message_app_environment_created_idx").on(
      t.organizationAppEnvironmentId,
      t.createdAt
    ),
    index("message_template_idx").on(t.templateId),
    uniqueIndex("message_app_environment_idempotency_uidx")
      .on(t.organizationAppEnvironmentId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ]
);

export type Message = typeof message.$inferSelect;
export type MessageInsert = typeof message.$inferInsert;

export const messageRelations = relations(message, ({ one }) => ({
  appEnvironment: one(organizationAppEnvironment, {
    fields: [message.organizationAppEnvironmentId],
    references: [organizationAppEnvironment.id],
  }),
  template: one(template, {
    fields: [message.templateId],
    references: [template.id],
  }),
}));
