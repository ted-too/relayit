import { relations, sql } from "drizzle-orm";
import {
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
import * as z from "zod";
import { organization } from "../auth";
import { channelEnum } from "../channels";
import { templatingWorkspaceEntry } from "./workspace";

/** Email (and later other channel) Template variant authoring engines. */
export const AVAILABLE_TEMPLATE_CHANNEL_ENGINES = [
  "primitive",
  "reactEmail",
] as const;

export const zTemplateChannelEngine = z.enum(
  AVAILABLE_TEMPLATE_CHANNEL_ENGINES
);

export type TemplateChannelEngine =
  (typeof AVAILABLE_TEMPLATE_CHANNEL_ENGINES)[number];

export const templateChannelEngineEnum = pgEnum(
  "template_channel_engine",
  AVAILABLE_TEMPLATE_CHANNEL_ENGINES
);

/**
 * Primitive email Channel Format strings (subject/html/text).
 * At least one of html | text is required at the app layer.
 */
export interface PrimitiveEmailContent {
  html?: string;
  subject: string;
  text?: string;
}

/**
 * Resend-shaped primitive Template Variables: map keyed by name.
 * No `required` flag — missing send value with no fallback fails Accept.
 */
export interface PrimitiveTemplateVariableDef {
  fallback?: string | number;
  type: "number" | "string";
}

export type PrimitiveTemplateVariables = Record<
  string,
  PrimitiveTemplateVariableDef
>;

/**
 * Project-scoped send catalog entry. Addressed by **id** or **slug** on the
 * send path. `name` is the human label; `slug` is auto-derived from `name`
 * and unique among active Templates in the Project. Soft-archived via
 * `archivedAt` (slug reusable while archived).
 */
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
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("template_organization_idx").on(t.organizationId),
    index("template_archived_at_idx").on(t.archivedAt),
    uniqueIndex("template_organization_slug_active_uidx")
      .on(t.organizationId, t.slug)
      .where(sql`${t.archivedAt} IS NULL`),
  ]
);

export type Template = typeof template.$inferSelect;

/**
 * One engine + payload per channel on a Template.
 *
 * `primitive`: `content` + `variables`; no workspace link.
 * `reactEmail`: `workspaceEntryId` only (`content` / `variables` null).
 */
export const templateChannelVariant = pgTable(
  "template_channel_variant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("tcvn").toString()),
    templateId: text("template_id")
      .notNull()
      .references(() => template.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    engine: templateChannelEngineEnum("engine").notNull(),
    /** Primitive email body fields. Null for reactEmail. */
    content: jsonb("content").$type<PrimitiveEmailContent>(),
    /** Primitive variable defs. Null for reactEmail. */
    variables: jsonb("variables").$type<PrimitiveTemplateVariables>(),
    /**
     * reactEmail link target. Null means broken/cleared (e.g. entry hard-deleted);
     * normal entry removal soft-deletes the entry and keeps this id for broken UX.
     */
    workspaceEntryId: text("workspace_entry_id").references(
      () => templatingWorkspaceEntry.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("template_channel_variant_template_channel_uidx").on(
      t.templateId,
      t.channel
    ),
    index("template_channel_variant_workspace_entry_idx").on(
      t.workspaceEntryId
    ),
    check(
      "template_channel_variant_engine_payload_check",
      sql`(
        ${t.engine} = 'primitive'
        AND ${t.workspaceEntryId} IS NULL
        AND ${t.content} IS NOT NULL
      ) OR (
        ${t.engine} = 'reactEmail'
        AND ${t.content} IS NULL
        AND ${t.variables} IS NULL
      )`
    ),
  ]
);

export type TemplateChannelVariant = typeof templateChannelVariant.$inferSelect;

export const templateRelations = relations(template, ({ one, many }) => ({
  organization: one(organization, {
    fields: [template.organizationId],
    references: [organization.id],
  }),
  channelVariants: many(templateChannelVariant),
}));

export const templateChannelVariantRelations = relations(
  templateChannelVariant,
  ({ one }) => ({
    template: one(template, {
      fields: [templateChannelVariant.templateId],
      references: [template.id],
    }),
    workspaceEntry: one(templatingWorkspaceEntry, {
      fields: [templateChannelVariant.workspaceEntryId],
      references: [templatingWorkspaceEntry.id],
    }),
  })
);
