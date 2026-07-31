import { db, schema, type TemplatingWorkspaceKind } from "@repo/api/db";
import { syncWorkspaceEntriesFromPaths } from "./entries";
import { HOSTED_DEV_REF, listFilesAtRef, scaffoldHostedWorkspace } from "./git";
import { getRuntimeWorkspaceKind } from "./runtime";

/**
 * Get or create the Project’s hosted Email Workspace for a kind.
 * First create scaffolds Git `dev`/`main` and mints entry rows for entry files.
 */
export async function getOrCreateHostedWorkspace(
  organizationId: string,
  kind: TemplatingWorkspaceKind
) {
  if (!getRuntimeWorkspaceKind(kind)) {
    throw new Error(`Unknown templating workspace kind: ${kind}`);
  }

  const existing = await db.query.templatingWorkspace.findFirst({
    where: (table, { eq, and }) =>
      and(
        eq(table.organizationId, organizationId),
        eq(table.kind, kind),
        eq(table.source, "hosted")
      ),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(schema.templatingWorkspace)
    .values({
      organizationId,
      kind,
      source: "hosted",
      updatedAt: new Date(),
    })
    .returning();

  const scaffolded = await scaffoldHostedWorkspace(created.id);
  if (scaffolded.error) {
    throw new Error(scaffolded.error.message);
  }

  const listed = await listFilesAtRef({
    workspaceId: created.id,
    ref: HOSTED_DEV_REF,
  });
  if (listed.data) {
    await syncWorkspaceEntriesFromPaths(created.id, listed.data.paths);
  }

  return created;
}

export function listWorkspaceEntries(workspaceId: string) {
  return db.query.templatingWorkspaceEntry.findMany({
    where: (table, { eq, and, isNull }) =>
      and(eq(table.workspaceId, workspaceId), isNull(table.deletedAt)),
    orderBy: (table, { asc }) => [asc(table.path)],
  });
}
