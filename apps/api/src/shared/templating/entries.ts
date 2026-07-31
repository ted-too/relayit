import { db, schema } from "@repo/api/db";
import { eq } from "drizzle-orm";
import { isReactEmailEntryPath } from "./kinds/react-email/paths";

/** Mint / revive entry rows for entry-path writes; soft-delete removed paths. */
export async function syncWorkspaceEntriesForPaths(input: {
  workspaceId: string;
  /** Current entry paths that exist after the commit (full set). */
  entryPaths: string[];
}) {
  const existing = await db.query.templatingWorkspaceEntry.findMany({
    where: (table, { eq: equals }) =>
      equals(table.workspaceId, input.workspaceId),
  });

  const byPath = new Map(existing.map((row) => [row.path, row]));
  const seen = new Set(input.entryPaths);

  for (const entryPath of input.entryPaths) {
    if (!isReactEmailEntryPath(entryPath)) {
      continue;
    }
    const row = byPath.get(entryPath);
    if (!row) {
      await db.insert(schema.templatingWorkspaceEntry).values({
        workspaceId: input.workspaceId,
        path: entryPath,
        updatedAt: new Date(),
      });
    } else if (row.deletedAt) {
      await db
        .update(schema.templatingWorkspaceEntry)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(schema.templatingWorkspaceEntry.id, row.id));
    }
  }

  for (const row of existing) {
    if (
      !(row.deletedAt || seen.has(row.path)) &&
      isReactEmailEntryPath(row.path)
    ) {
      await db
        .update(schema.templatingWorkspaceEntry)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.templatingWorkspaceEntry.id, row.id));
    }
  }
}

/** After a partial commit, sync entries from the new tip’s full tree. */
export function syncWorkspaceEntriesFromPaths(
  workspaceId: string,
  allPaths: string[]
) {
  return syncWorkspaceEntriesForPaths({
    workspaceId,
    entryPaths: allPaths.filter(isReactEmailEntryPath),
  });
}
