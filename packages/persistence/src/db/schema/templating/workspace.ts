import { sql } from "drizzle-orm";
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

/** Kinded authoring workspaces under `/templating/workspace/:kind`. */
export const AVAILABLE_TEMPLATING_WORKSPACE_KINDS = ["reactEmail"] as const;

export const zTemplatingWorkspaceKind = z.enum(
  AVAILABLE_TEMPLATING_WORKSPACE_KINDS
);

export type TemplatingWorkspaceKind =
  (typeof AVAILABLE_TEMPLATING_WORKSPACE_KINDS)[number];

export const templatingWorkspaceKindEnum = pgEnum(
  "templating_workspace_kind",
  AVAILABLE_TEMPLATING_WORKSPACE_KINDS
);

/** How an Email Workspace’s Git tree is authored/updated. */
export const AVAILABLE_TEMPLATING_WORKSPACE_SOURCES = [
  "hosted",
  "github",
] as const;

export const zTemplatingWorkspaceSource = z.enum(
  AVAILABLE_TEMPLATING_WORKSPACE_SOURCES
);

export type TemplatingWorkspaceSource =
  (typeof AVAILABLE_TEMPLATING_WORKSPACE_SOURCES)[number];

export const templatingWorkspaceSourceEnum = pgEnum(
  "templating_workspace_source",
  AVAILABLE_TEMPLATING_WORKSPACE_SOURCES
);

/**
 * Inferred props shape for a Workspace Entry after a successful build.
 * Stored as JSON for API validation; exact schema evolves with the builder.
 */
export type WorkspaceEntryPropsShape = Record<string, unknown>;

/**
 * Kinded Email Workspace for a Project. Source of truth is Git (objects in
 * object storage; branch tips in `templating_workspace_ref`). v1 uses `hosted`;
 * `github` is a reserved seam.
 */
export const templatingWorkspace = pgTable(
  "templating_workspace",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("twsp").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: templatingWorkspaceKindEnum("kind").notNull(),
    source: templatingWorkspaceSourceEnum("source").notNull().default("hosted"),
    /** GitHub seam only — e.g. `acme/emails`. Null for hosted. */
    githubRepository: text("github_repository"),
    /** GitHub seam — track branch chosen at link time. Null for hosted. */
    githubTrackBranch: text("github_track_branch"),
    lastBuildAt: timestamp("last_build_at"),
    lastBuildError: text("last_build_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    /** At most one hosted workspace per Project per kind. */
    uniqueIndex("templating_workspace_organization_kind_hosted_uidx")
      .on(t.organizationId, t.kind)
      .where(sql`${t.source} = 'hosted'`),
    index("templating_workspace_organization_idx").on(t.organizationId),
    check(
      "templating_workspace_source_fields_check",
      sql`(
        ${t.source} = 'hosted'
        AND ${t.githubRepository} IS NULL
        AND ${t.githubTrackBranch} IS NULL
      ) OR (
        ${t.source} = 'github'
        AND ${t.githubRepository} IS NOT NULL
        AND ${t.githubTrackBranch} IS NOT NULL
      )`
    ),
  ]
);

export type TemplatingWorkspace = typeof templatingWorkspace.$inferSelect;

/**
 * Mutable Git branch tip for a workspace (`dev` / `main` for hosted).
 * Immutable Git objects live in object storage, keyed by workspace + sha.
 */
export const templatingWorkspaceRef = pgTable(
  "templating_workspace_ref",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("twrf").toString()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => templatingWorkspace.id, { onDelete: "cascade" }),
    /** Branch name — hosted uses `dev` and `main`. */
    name: text("name").notNull(),
    /** Git commit object id (hex sha). */
    sha: text("sha").notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("templating_workspace_ref_workspace_name_uidx").on(
      t.workspaceId,
      t.name
    ),
    index("templating_workspace_ref_workspace_idx").on(t.workspaceId),
  ]
);

export type TemplatingWorkspaceRef = typeof templatingWorkspaceRef.$inferSelect;

/**
 * Pickable React Email (etc.) entry. Id is minted when the entry file is
 * created; path may change. Soft-deleted when the entry file is removed so
 * Template links can surface as broken. Pickable only when
 * `artifactStorageKey` is set (last successful Publish / build).
 */
export const templatingWorkspaceEntry = pgTable(
  "templating_workspace_entry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("twen").toString()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => templatingWorkspace.id, { onDelete: "cascade" }),
    /** Current path within the workspace (e.g. reactEmail/welcome.tsx). */
    path: text("path").notNull(),
    /** Object key for the last successful sealed render artifact. */
    artifactStorageKey: text("artifact_storage_key"),
    /** Git commit sha that produced the live artifact (main tip at Publish). */
    artifactCommitSha: text("artifact_commit_sha"),
    inferredProps: jsonb("inferred_props").$type<WorkspaceEntryPropsShape>(),
    builtAt: timestamp("built_at"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("templating_workspace_entry_workspace_idx").on(t.workspaceId),
    index("templating_workspace_entry_deleted_at_idx").on(t.deletedAt),
    uniqueIndex("templating_workspace_entry_workspace_path_active_uidx")
      .on(t.workspaceId, t.path)
      .where(sql`${t.deletedAt} IS NULL`),
  ]
);

export type TemplatingWorkspaceEntry =
  typeof templatingWorkspaceEntry.$inferSelect;
