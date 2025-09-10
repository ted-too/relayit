import { type InferSelectModel, relations } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "./auth";

export const app = pgTable(
  "app",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("app").toString()),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("app_slug_org_unique_idx").on(t.slug, t.organizationId),
    index("app_organization_idx").on(t.organizationId),
  ]
);

export type App = InferSelectModel<typeof app>;

export const appRelations = relations(app, ({ one }) => ({
  organization: one(organization, {
    fields: [app.organizationId],
    references: [organization.id],
  }),
}));
