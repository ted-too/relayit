import { db, schema } from "@repo/api/db";
import { createGenericError, type Result } from "@repo/api/utils";
import { and, eq } from "drizzle-orm";

export async function getRef(
  workspaceId: string,
  name: string
): Promise<string | null> {
  const row = await db.query.templatingWorkspaceRef.findFirst({
    where: (table, { eq: equals, and: combine }) =>
      combine(equals(table.workspaceId, workspaceId), equals(table.name, name)),
  });
  return row?.sha ?? null;
}

export async function listRefs(
  workspaceId: string
): Promise<Array<{ name: string; sha: string }>> {
  const rows = await db.query.templatingWorkspaceRef.findMany({
    where: (table, { eq: equals }) => equals(table.workspaceId, workspaceId),
  });
  return rows.map((row) => ({ name: row.name, sha: row.sha }));
}

/** Compare-and-swap ref update. Pass `expectedSha: null` to create. */
export async function updateRef(input: {
  workspaceId: string;
  name: string;
  sha: string;
  expectedSha: string | null;
}): Promise<Result<{ sha: string }>> {
  const { workspaceId, name, sha, expectedSha } = input;
  const existing = await getRef(workspaceId, name);

  if (existing !== expectedSha) {
    return {
      error: createGenericError(
        `Ref ${name} CAS failed (expected ${expectedSha}, was ${existing})`
      ),
      data: null,
    };
  }

  if (existing === null) {
    await db.insert(schema.templatingWorkspaceRef).values({
      workspaceId,
      name,
      sha,
    });
  } else {
    await db
      .update(schema.templatingWorkspaceRef)
      .set({ sha, updatedAt: new Date() })
      .where(
        and(
          eq(schema.templatingWorkspaceRef.workspaceId, workspaceId),
          eq(schema.templatingWorkspaceRef.name, name)
        )
      );
  }

  return { error: null, data: { sha } };
}
