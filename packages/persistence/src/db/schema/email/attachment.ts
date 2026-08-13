import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { emailDelivery } from "./delivery";

export const emailAttachmentContentDispositionEnum = pgEnum(
  "email_attachment_content_disposition",
  ["inline", "attachment"]
);

/**
 * File staged for an email Delivery (Delivery-owned Attachment).
 * `storageKey` points at object storage; `expiresAt` is when the object may be deleted.
 */
export const emailAttachment = pgTable(
  "email_attachment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("eatc").toString()),
    emailDeliveryId: text("email_delivery_id")
      .notNull()
      .references(() => emailDelivery.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    contentDisposition: emailAttachmentContentDispositionEnum(
      "content_disposition"
    ).notNull(),
    contentId: text("content_id"),
    storageKey: text("storage_key").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "email_attachment_inline_content_id_check",
      sql`${t.contentDisposition} != 'inline' OR ${t.contentId} IS NOT NULL`
    ),
    index("email_attachment_delivery_idx").on(t.emailDeliveryId),
    index("email_attachment_expires_at_idx").on(t.expiresAt),
  ]
);

export type EmailAttachment = typeof emailAttachment.$inferSelect;
