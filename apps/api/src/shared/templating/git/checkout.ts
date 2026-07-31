import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createGenericError, type Result } from "@repo/api/utils";
import { readTreeAtCommit } from "./commit";
import { getBlob } from "./objects";
import { getRef } from "./refs";

/** Materialize a ref’s tree into `destDir` (created if missing). */
export async function checkoutRefToDirectory(input: {
  workspaceId: string;
  ref: string;
  destDir: string;
}): Promise<Result<{ commitSha: string }>> {
  const tip = await getRef(input.workspaceId, input.ref);
  if (!tip) {
    return {
      error: createGenericError(`Unknown ref ${input.ref}`),
      data: null,
    };
  }

  const tree = await readTreeAtCommit(input.workspaceId, tip);
  if (tree.error || !tree.data) {
    return { error: tree.error, data: null };
  }

  await fs.mkdir(input.destDir, { recursive: true });

  for (const [filePath, blobId] of Object.entries(tree.data)) {
    const blob = await getBlob(input.workspaceId, blobId);
    if (blob.error || !blob.data) {
      return {
        error:
          blob.error ??
          createGenericError(`Failed to read blob for ${filePath}`),
        data: null,
      };
    }
    const abs = path.join(input.destDir, filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, blob.data);
  }

  return { error: null, data: { commitSha: tip } };
}
