import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "./auth";
import { message } from "./message";

export const messageIdempotency = pgTable(
  "message_idempotency",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("midem").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("message_idempotency_organization_key_uidx").on(
      table.organizationId,
      table.key
    ),
    index("message_idempotency_expires_at_idx").on(table.expiresAt),
  ]
);

export type MessageIdempotency = typeof messageIdempotency.$inferSelect;
