import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import type { EmailAddressList, EmailFrom, EmailHeaders } from "../../validators/channels/email";
import { type DeliveryError, deliveryStatusEnum } from "../channels";
import { message } from "../message";
import { customDomain } from "./custom-domain";
import { sandboxDomain } from "./sandbox-domain";

/**
 * Email Delivery — per-channel attempt of a Message, owning email Channel Format
 * and Delivery status. SES retries a soft bounce itself (no new Delivery).
 *
 * A Delivery outlives the Domain it was sent from. Removing a Domain moves each of its
 * Deliveries from `customDomainId` to `removedDomainFqdn` before deleting its row, so the
 * sender check holds throughout and a Delivery can't be written naming no sender at all:
 * accept never sets `removedDomainFqdn`. The foreign key stays `RESTRICT`, so a Domain can't
 * be deleted from under Deliveries that were not moved first.
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
    sandboxDomainId: text("sandbox_domain_id").references(() => sandboxDomain.id, {
      onDelete: "restrict",
    }),
    /**
     * The FQDN of the Domain this was sent from, once that Domain is removed. Text and not
     * a reference on purpose: a Domain added later under the same FQDN is another Domain,
     * with its own key and holder, and must never be joined to these Deliveries by name.
     */
    removedDomainFqdn: text("removed_domain_fqdn"),
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
    providerMessageId: text("provider_message_id"),
    error: jsonb("error").$type<DeliveryError>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    check("email_delivery_body_present_check", sql`${t.html} IS NOT NULL OR ${t.text} IS NOT NULL`),
    check(
      "email_delivery_sender_kind_check",
      sql`num_nonnulls(${t.customDomainId}, ${t.sandboxDomainId}, ${t.removedDomainFqdn}) = 1`,
    ),
    index("email_delivery_message_idx").on(t.messageId),
    index("email_delivery_status_idx").on(t.status),
    index("email_delivery_custom_domain_idx").on(t.customDomainId),
    index("email_delivery_sandbox_domain_idx").on(t.sandboxDomainId),
    uniqueIndex("email_delivery_provider_message_id_unique_idx")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
  ],
);

export type EmailDelivery = typeof emailDelivery.$inferSelect;
export type EmailDeliveryInsert = typeof emailDelivery.$inferInsert;
