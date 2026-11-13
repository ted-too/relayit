import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import type { StoredProviderCredentials } from "../../crypto/provider-credentials";
import { channelEnum } from "./channels";

/**
 * The platform's credentials for an upstream channel primitive (e.g. SES), wired by ops.
 * At most one per channel is `isDefault`: the one a Domain is registered with when its
 * create names none, read at that moment and never stored per Project.
 *
 * `channelType` + `vendorId` + `productId` locate the registry config used for ops.
 */
export const provider = pgTable(
  "provider",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("prov").toString()),
    channelType: channelEnum("channel_type").notNull(),
    vendorId: text("vendor_id").notNull(),
    productId: text("product_id").notNull(),
    /** The one a Domain is registered with when its create names none. */
    isDefault: boolean("is_default").notNull().default(false),
    name: text("name"),
    credentials: jsonb("credentials").$type<StoredProviderCredentials>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("provider_default_per_channel_uidx")
      .on(t.channelType)
      .where(sql`${t.isDefault} = true`),
    index("provider_channel_type_idx").on(t.channelType),
    index("provider_vendor_product_idx").on(t.vendorId, t.productId),
  ],
);

export type Provider = typeof provider.$inferSelect;
