import type { ChannelContent } from "@repo/shared/forms";
import { type InferSelectModel, relations } from "drizzle-orm";
import {
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
import type { JSONSchema } from "./json-schema";

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

    category: templateCategoryEnum("category").default("transactional"),
    status: templateStatusEnum("status").default("draft"),
    currentVersionId: text("current_version_id"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("template_org_slug_unique_idx").on(t.organizationId, t.slug),
    index("template_organization_idx").on(t.organizationId),
    index("template_status_idx").on(t.status),
    index("template_category_idx").on(t.category),
    index("template_current_version_idx").on(t.currentVersionId),
  ]
);

export type Template = InferSelectModel<typeof template>;

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
    schema: jsonb("schema").$type<JSONSchema>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("template_version_template_version_unique_idx").on(
      t.templateId,
      t.version
    ),
    index("template_version_template_idx").on(t.templateId),
    index("template_version_created_at_idx").on(t.createdAt),
  ]
);

export type TemplateVersion = InferSelectModel<typeof templateVersion>;

// Channel-specific template content linked to versions
export const templateChannelVersion = pgTable(
  "template_channel_version",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("tcvr").toString()),
    templateVersionId: text("template_version_id")
      .notNull()
      .references(() => templateVersion.id, { onDelete: "cascade" }),

    channel: channelEnum("channel").notNull(),
    content: jsonb("content").$type<ChannelContent["content"]>().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("template_channel_version_unique_idx").on(
      t.templateVersionId,
      t.channel
    ),
    index("template_channel_version_template_idx").on(t.templateVersionId),
    index("template_channel_version_channel_idx").on(t.channel),
  ]
);

export type TemplateChannelVersion = InferSelectModel<
  typeof templateChannelVersion
>;

export interface TemplateWithVersions extends Template {
  currentVersion: TemplateVersion & {
    channelVersions: TemplateChannelVersion[];
  };
  previousVersions: (TemplateVersion & {
    channelVersions: TemplateChannelVersion[];
  })[];
}

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
    channelVersions: many(templateChannelVersion),
  })
);

export const templateChannelVersionRelations = relations(
  templateChannelVersion,
  ({ one }) => ({
    templateVersion: one(templateVersion, {
      fields: [templateChannelVersion.templateVersionId],
      references: [templateVersion.id],
    }),
  })
);
