import { createGenericError, type Result } from "@repo/api/utils";
import {
  getBlob,
  getCommit,
  getTree,
  putBlob,
  putCommit,
  putTree,
} from "./objects";
import { getRef, updateRef } from "./refs";
import type { GitTree } from "./types";

export async function readTreeAtCommit(
  workspaceId: string,
  commitSha: string
): Promise<Result<Record<string, string>>> {
  const commit = await getCommit(workspaceId, commitSha);
  if (commit.error || !commit.data) {
    return { error: commit.error, data: null };
  }
  const tree = await getTree(workspaceId, commit.data.tree);
  if (tree.error || !tree.data) {
    return { error: tree.error, data: null };
  }
  return { error: null, data: tree.data.files };
}

export async function readFileAtRef(input: {
  workspaceId: string;
  ref: string;
  path: string;
}): Promise<Result<{ content: string; commitSha: string }>> {
  const tip = await getRef(input.workspaceId, input.ref);
  if (!tip) {
    return {
      error: createGenericError(`Unknown ref ${input.ref}`),
      data: null,
    };
  }
  const files = await readTreeAtCommit(input.workspaceId, tip);
  if (files.error || !files.data) {
    return { error: files.error, data: null };
  }
  const blobId = files.data[input.path];
  if (!blobId) {
    return {
      error: createGenericError(`File not found: ${input.path}`),
      data: null,
    };
  }
  const blob = await getBlob(input.workspaceId, blobId);
  if (blob.error || !blob.data) {
    return { error: blob.error, data: null };
  }
  return {
    error: null,
    data: {
      content: new TextDecoder().decode(blob.data),
      commitSha: tip,
    },
  };
}

export async function listFilesAtRef(input: {
  workspaceId: string;
  ref: string;
}): Promise<Result<{ paths: string[]; commitSha: string }>> {
  const tip = await getRef(input.workspaceId, input.ref);
  if (!tip) {
    return {
      error: createGenericError(`Unknown ref ${input.ref}`),
      data: null,
    };
  }
  const files = await readTreeAtCommit(input.workspaceId, tip);
  if (files.error || !files.data) {
    return { error: files.error, data: null };
  }
  return {
    error: null,
    data: {
      paths: Object.keys(files.data).sort(),
      commitSha: tip,
    },
  };
}

/**
 * Commit a set of path writes onto a ref (full replace of listed paths;
 * omitted paths are kept from the parent tree).
 */
export async function commitFiles(input: {
  workspaceId: string;
  ref: string;
  message: string;
  author?: string;
  /** path → utf8 content; `null` deletes the path */
  changes: Record<string, string | null>;
}): Promise<Result<{ commitSha: string }>> {
  const parentSha = await getRef(input.workspaceId, input.ref);
  let parentFiles: Record<string, string> = {};

  if (parentSha) {
    const parentTree = await readTreeAtCommit(input.workspaceId, parentSha);
    if (parentTree.error || !parentTree.data) {
      return { error: parentTree.error, data: null };
    }
    parentFiles = { ...parentTree.data };
  }

  const nextFiles = { ...parentFiles };

  for (const [path, content] of Object.entries(input.changes)) {
    if (content === null) {
      delete nextFiles[path];
      continue;
    }
    const blob = await putBlob(input.workspaceId, content);
    if (blob.error || !blob.data) {
      return {
        error:
          blob.error ?? createGenericError(`Failed to store blob for ${path}`),
        data: null,
      };
    }
    nextFiles[path] = blob.data;
  }

  const treePayload: GitTree = { files: nextFiles };
  const tree = await putTree(input.workspaceId, treePayload);
  if (tree.error || !tree.data) {
    return {
      error: tree.error ?? createGenericError("Failed to store tree"),
      data: null,
    };
  }

  const commit = await putCommit(input.workspaceId, {
    tree: tree.data,
    parent: parentSha,
    message: input.message,
    author: input.author ?? "relayit",
    timestamp: new Date().toISOString(),
  });
  if (commit.error || !commit.data) {
    return {
      error: commit.error ?? createGenericError("Failed to store commit"),
      data: null,
    };
  }

  const refUpdate = await updateRef({
    workspaceId: input.workspaceId,
    name: input.ref,
    sha: commit.data,
    expectedSha: parentSha,
  });
  if (refUpdate.error) {
    return { error: refUpdate.error, data: null };
  }

  return { error: null, data: { commitSha: commit.data } };
}
