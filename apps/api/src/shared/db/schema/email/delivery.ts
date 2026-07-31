import type {
  EmailAddressList,
  EmailFrom,
  EmailHeaders,
} from "@repo/api/validators/routes/messages";
import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { type DeliveryError, deliveryStatusEnum } from "../channels";
import { message } from "../message";
import { provider } from "../provider";
import { customDomain } from "./custom-domain";
import { sandboxDomain } from "./sandbox-domain";

/**
 * Email Delivery — per-channel attempt of a Message, owning email Channel Format
 * and Delivery status. Soft-bounce retries are Provider-owned (no new Delivery).
 */
export const emailDelivery = pgTable(
  "email_delivery",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("edlv").toString()),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    customDomainId: text("custom_domain_id").references(() => customDomain.id, {
      onDelete: "restrict",
    }),
    sandboxDomainId: text("sandbox_domain_id").references(
      () => sandboxDomain.id,
      { onDelete: "restrict" }
    ),
    status: deliveryStatusEnum("status").notNull().default("queued"),
    from: jsonb("from").$type<EmailFrom>().notNull(),
    to: jsonb("to").$type<EmailAddressList>().notNull(),
    cc: jsonb("cc").$type<EmailAddressList>(),
    bcc: jsonb("bcc").$type<EmailAddressList>(),
    replyTo: jsonb("reply_to").$type<EmailAddressList>(),
    subject: text("subject").notNull(),
    html: text("html"),
    text: text("text"),
    headers: jsonb("headers").$type<EmailHeaders>(),
    providerId: text("provider_id").references(() => provider.id, {
      onDelete: "set null",
    }),
    providerMessageId: text("provider_message_id"),
    error: jsonb("error").$type<DeliveryError>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    check(
      "email_delivery_body_present_check",
      sql`${t.html} IS NOT NULL OR ${t.text} IS NOT NULL`
    ),
    check(
      "email_delivery_sender_kind_check",
      sql`(${t.customDomainId} IS NOT NULL) <> (${t.sandboxDomainId} IS NOT NULL)`
    ),
    index("email_delivery_message_idx").on(t.messageId),
    index("email_delivery_status_idx").on(t.status),
    index("email_delivery_custom_domain_idx").on(t.customDomainId),
    index("email_delivery_sandbox_domain_idx").on(t.sandboxDomainId),
    index("email_delivery_provider_idx").on(t.providerId),
    uniqueIndex("email_delivery_provider_message_id_unique_idx")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
  ]
);

export type EmailDelivery = typeof emailDelivery.$inferSelect;
export type EmailDeliveryInsert = typeof emailDelivery.$inferInsert;

export const emailDeliveryRelations = relations(emailDelivery, ({ one }) => ({
  message: one(message, {
    fields: [emailDelivery.messageId],
    references: [message.id],
  }),
  customDomain: one(customDomain, {
    fields: [emailDelivery.customDomainId],
    references: [customDomain.id],
  }),
  sandboxDomain: one(sandboxDomain, {
    fields: [emailDelivery.sandboxDomainId],
    references: [sandboxDomain.id],
  }),
  provider: one(provider, {
    fields: [emailDelivery.providerId],
    references: [provider.id],
  }),
}));
