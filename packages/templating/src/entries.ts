import { DB } from "@repo/persistence/db/effect";
import { templatingWorkspaceEntry } from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { isReactEmailEntryPath } from "./kinds/react-email/paths";
import { TemplatingBuilderError } from "./rpc/errors";

/** Mint / revive entry rows for entry-path writes; soft-delete removed paths. */
export const syncWorkspaceEntriesForPaths = (input: {
  entryPaths: string[];
  workspaceId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const existing = yield* db.query.templatingWorkspaceEntry
      .findMany({
        where: { workspaceId: input.workspaceId },
      })
      .pipe(
        Effect.mapError(
          () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to load workspace entries.",
            })
        )
      );

    const byPath = new Map(existing.map((row) => [row.path, row]));
    const seen = new Set(input.entryPaths);

    for (const entryPath of input.entryPaths) {
      if (!isReactEmailEntryPath(entryPath)) {
        continue;
      }
      const row = byPath.get(entryPath);
      if (!row) {
        yield* db
          .insert(templatingWorkspaceEntry)
          .values({
            path: entryPath,
            updatedAt: new Date(),
            workspaceId: input.workspaceId,
          })
          .pipe(
            Effect.mapError(
              () =>
                new TemplatingBuilderError({
                  code: "failed",
                  message: "Failed to create workspace entry.",
                })
            )
          );
      } else if (row.deletedAt) {
        yield* db
          .update(templatingWorkspaceEntry)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(templatingWorkspaceEntry.id, row.id))
          .pipe(
            Effect.mapError(
              () =>
                new TemplatingBuilderError({
                  code: "failed",
                  message: "Failed to revive workspace entry.",
                })
            )
          );
      }
    }

    for (const row of existing) {
      if (
        !(row.deletedAt || seen.has(row.path)) &&
        isReactEmailEntryPath(row.path)
      ) {
        yield* db
          .update(templatingWorkspaceEntry)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(templatingWorkspaceEntry.id, row.id))
          .pipe(
            Effect.mapError(
              () =>
                new TemplatingBuilderError({
                  code: "failed",
                  message: "Failed to soft-delete workspace entry.",
                })
            )
          );
      }
    }
  });

/** After a partial commit, sync entries from the new tip’s full tree. */
export const syncWorkspaceEntriesFromPaths = (
  workspaceId: string,
  allPaths: string[]
) =>
  syncWorkspaceEntriesForPaths({
    entryPaths: allPaths.filter(isReactEmailEntryPath),
    workspaceId,
  });
