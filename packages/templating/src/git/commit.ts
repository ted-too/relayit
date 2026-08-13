import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";
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

export const readTreeAtCommit = (workspaceId: string, commitSha: string) =>
  Effect.gen(function* () {
    const commit = yield* getCommit(workspaceId, commitSha);
    const tree = yield* getTree(workspaceId, commit.tree);
    return tree.files;
  });

export const readFileAtRef = (input: {
  path: string;
  ref: string;
  workspaceId: string;
}) =>
  Effect.gen(function* () {
    const tip = yield* getRef(input.workspaceId, input.ref);
    if (!tip) {
      return yield* new TemplatingBuilderError({
        code: "not_found",
        message: "Unknown workspace ref.",
      });
    }
    const files = yield* readTreeAtCommit(input.workspaceId, tip);
    const blobId = files[input.path];
    if (!blobId) {
      return yield* new TemplatingBuilderError({
        code: "not_found",
        message: "Workspace file not found.",
      });
    }
    const blob = yield* getBlob(input.workspaceId, blobId);
    return {
      commitSha: tip,
      content: new TextDecoder().decode(blob),
    };
  });

export const listFilesAtRef = (input: { ref: string; workspaceId: string }) =>
  Effect.gen(function* () {
    const tip = yield* getRef(input.workspaceId, input.ref);
    if (!tip) {
      return yield* new TemplatingBuilderError({
        code: "not_found",
        message: "Unknown workspace ref.",
      });
    }
    const files = yield* readTreeAtCommit(input.workspaceId, tip);
    return {
      commitSha: tip,
      paths: Object.keys(files).sort(),
    };
  });

/**
 * Commit a set of path writes onto a ref (full replace of listed paths;
 * omitted paths are kept from the parent tree).
 */
export const commitFiles = (input: {
  author?: string;
  changes: Record<string, string | null>;
  message: string;
  ref: string;
  workspaceId: string;
}) =>
  Effect.gen(function* () {
    const parentSha = yield* getRef(input.workspaceId, input.ref);
    let parentFiles: Record<string, string> = {};

    if (parentSha) {
      parentFiles = {
        ...(yield* readTreeAtCommit(input.workspaceId, parentSha)),
      };
    }

    const nextFiles = { ...parentFiles };

    for (const [path, content] of Object.entries(input.changes)) {
      if (content === null) {
        delete nextFiles[path];
        continue;
      }
      const blobId = yield* putBlob(input.workspaceId, content);
      nextFiles[path] = blobId;
    }

    const treePayload: GitTree = { files: nextFiles };
    const treeId = yield* putTree(input.workspaceId, treePayload);

    const commitSha = yield* putCommit(input.workspaceId, {
      author: input.author ?? "relayit",
      message: input.message,
      parent: parentSha,
      timestamp: new Date().toISOString(),
      tree: treeId,
    });

    yield* updateRef({
      expectedSha: parentSha,
      name: input.ref,
      sha: commitSha,
      workspaceId: input.workspaceId,
    });

    return { commitSha };
  });
