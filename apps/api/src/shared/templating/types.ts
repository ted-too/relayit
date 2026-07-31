import type {
  TemplatingWorkspaceKind,
  WorkspaceEntryPropsShape,
} from "@repo/api/db";

/**
 * Client/metadata surface for a workspace kind (labels, entry path rules).
 * Analogous to client provider product config.
 */
export interface ClientWorkspaceKindConfig {
  /** Directory root for entry files (e.g. `reactEmail`). */
  entryRoot: string;
  /** Filename stem for an entry path, else null. */
  entrySlugFromPath: (path: string) => string | null;
  id: TemplatingWorkspaceKind;
  /** True when `path` is a mintable Workspace Entry for this kind. */
  isEntryPath: (path: string) => boolean;
  label: string;
}

/**
 * Runtime ops a workspace kind must implement to plug into the registry.
 * Publish / deps sync live on the templating-builder — not here.
 */
export interface WorkspaceKindOps {
  inferPropsFromEntrySource: (source: string) => WorkspaceEntryPropsShape;
}

export type RuntimeWorkspaceKindConfig = ClientWorkspaceKindConfig &
  WorkspaceKindOps;
