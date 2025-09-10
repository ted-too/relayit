import { type InferSelectModel, relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";
import { organization } from "./auth";
import { channelEnum, templateCategoryEnum, templateStatusEnum } from "./enums";

// Organization-scoped template metadata with version references
export const template = pgTable(
  "template",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("tmpl").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    slug: text("slug").notNull(),

    channel: channelEnum("channel").notNull(),
    category: templateCategoryEnum("category").default("transactional"),
    status: templateStatusEnum("status").default("draft"),
    currentVersionId: text("current_version_id"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("template_org_channel_slug_unique_idx").on(
      t.organizationId,
      t.channel,
      t.slug
    ),
    index("template_organization_idx").on(t.organizationId),
    index("template_channel_idx").on(t.channel),
    index("template_status_idx").on(t.status),
    index("template_category_idx").on(t.category),
    index("template_current_version_idx").on(t.currentVersionId),
  ]
);

// Immutable template versions (never modified once used)
export const templateVersion = pgTable(
  "template_version",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("tmvr").toString()),
    templateId: text("template_id")
      .notNull()
      .references(() => template.id, { onDelete: "cascade" }),

    version: integer("version").notNull(),
    content: jsonb("content").notNull(),
    schema: jsonb("schema"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("template_version_template_version_unique_idx").on(
      t.templateId,
      t.version
    ),
    index("template_version_template_idx").on(t.templateId),
    index("template_version_active_idx").on(t.isActive),
    index("template_version_created_at_idx").on(t.createdAt),
  ]
);

export type Template = InferSelectModel<typeof template>;
export type TemplateVersion = InferSelectModel<typeof templateVersion>;

export const templateRelations = relations(template, ({ one, many }) => ({
  organization: one(organization, {
    fields: [template.organizationId],
    references: [organization.id],
  }),
  currentVersion: one(templateVersion, {
    fields: [template.currentVersionId],
    references: [templateVersion.id],
    relationName: "currentTemplateVersion",
  }),
  versions: many(templateVersion),
}));

export const templateVersionRelations = relations(
  templateVersion,
  ({ one, many }) => ({
    template: one(template, {
      fields: [templateVersion.templateId],
      references: [template.id],
    }),
    currentForTemplates: many(template, {
      relationName: "currentTemplateVersion",
    }),
  })
);
