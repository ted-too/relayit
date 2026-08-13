import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import type { StoredProviderCredentials } from "../../crypto/provider-credentials";
import { organization } from "./auth";
import { channelEnum } from "./channels";

export const providerScopeEnum = pgEnum("provider_scope", [
  "platform",
  "project",
]);

export type ProviderScope = (typeof providerScopeEnum.enumValues)[number];

/**
 * Credentials used to talk to an upstream channel primitive (e.g. SES).
 *
 * `scope` decides ownership:
 *   - `platform` → ops-wired managed backend; `organizationId` is null.
 *     At most one platform provider per channel may be `isDefault` (used when
 *     Domain create omits providerId — see ADR-0007).
 *   - `project` → Project-owned BYO; `organizationId` is set. Credentials do
 *     not span Projects (see ADR-0006).
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
    scope: providerScopeEnum("scope").notNull().default("project"),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    /** Ops-only: current default managed backend when Domain create omits providerId. */
    isDefault: boolean("is_default").notNull().default(false),
    name: text("name"),
    credentials: jsonb("credentials")
      .$type<StoredProviderCredentials>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    check(
      "provider_scope_organization_id_check",
      sql`(${t.scope} = 'project' AND ${t.organizationId} IS NOT NULL) OR (${t.scope} = 'platform' AND ${t.organizationId} IS NULL)`
    ),
    check(
      "provider_is_default_platform_only_check",
      sql`(${t.isDefault} = false) OR (${t.scope} = 'platform')`
    ),
    uniqueIndex("provider_platform_default_per_channel_uidx")
      .on(t.channelType)
      .where(sql`${t.scope} = 'platform' AND ${t.isDefault} = true`),
    index("provider_channel_type_idx").on(t.channelType),
    index("provider_scope_idx").on(t.scope),
    index("provider_organization_idx").on(t.organizationId),
    index("provider_vendor_product_idx").on(t.vendorId, t.productId),
  ]
);

export type Provider = typeof provider.$inferSelect;
