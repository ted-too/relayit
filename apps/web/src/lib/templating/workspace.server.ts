import { DB } from "@repo/persistence/db/effect";
import { templatingWorkspace } from "@repo/persistence/db/schema";
import { Data, Effect } from "effect";
import type { WorkspaceEntryListItem } from "./types";

export class TemplateWorkspaceError extends Data.TaggedError(
  "TemplateWorkspaceError"
)<{
  readonly cause?: unknown;
  readonly code: "not_found" | "failed";
  readonly message: string;
}> {}

/** Catalog-side workspace metadata (Postgres). Git scaffold happens via builder. */
export const getOrCreateHostedWorkspaceMeta = (input: {
  readonly kind: "reactEmail";
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const existing = yield* db.query.templatingWorkspace
      .findFirst({
        where: {
          kind: input.kind,
          organizationId: input.organizationId,
          source: "hosted",
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateWorkspaceError({
              cause,
              code: "failed",
              message: "Failed to load Email Workspace.",
            })
        )
      );

    if (existing) {
      return existing;
    }

    const [created] = yield* db
      .insert(templatingWorkspace)
      .values({
        kind: input.kind,
        organizationId: input.organizationId,
        source: "hosted",
        updatedAt: new Date(),
      })
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateWorkspaceError({
              cause,
              code: "failed",
              message: "Failed to create Email Workspace.",
            })
        )
      );

    if (!created) {
      return yield* new TemplateWorkspaceError({
        code: "failed",
        message: "Failed to create Email Workspace.",
      });
    }

    return created;
  });

export const listWorkspaceEntriesForProject = (input: {
  readonly kind: "reactEmail";
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const workspace = yield* getOrCreateHostedWorkspaceMeta(input);
    const db = yield* DB;
    const entries = yield* db.query.templatingWorkspaceEntry
      .findMany({
        orderBy: { path: "asc" },
        where: {
          deletedAt: { isNull: true },
          workspaceId: workspace.id,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new TemplateWorkspaceError({
              cause,
              code: "failed",
              message: "Failed to list Workspace Entries.",
            })
        )
      );

    return entries.map(
      (entry): WorkspaceEntryListItem => ({
        artifactCommitSha: entry.artifactCommitSha,
        artifactStorageKey: entry.artifactStorageKey,
        builtAt: entry.builtAt,
        createdAt: entry.createdAt,
        deletedAt: entry.deletedAt,
        id: entry.id,
        path: entry.path,
        pickable: Boolean(!entry.deletedAt && entry.artifactStorageKey),
        updatedAt: entry.updatedAt,
      })
    );
  });
