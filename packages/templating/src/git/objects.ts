import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";
import { templatingGitObjects } from "../storage";
import { decodeJson, encodeJson, hashObject } from "./hash";
import type { GitCommit, GitObjectType, GitTree } from "./types";

const putRaw = (
  workspaceId: string,
  type: GitObjectType,
  content: Uint8Array
) =>
  Effect.gen(function* () {
    const objectId = hashObject(type, content);
    yield* templatingGitObjects
      .upload({ objectId, workspaceId }, content, {
        contentType: "application/octet-stream",
      })
      .pipe(
        Effect.mapError(
          () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to store Git object.",
            })
        )
      );
    return objectId;
  });

const getRaw = (workspaceId: string, objectId: string) =>
  Effect.gen(function* () {
    const downloaded = yield* templatingGitObjects
      .download({ objectId, workspaceId })
      .pipe(
        Effect.mapError(
          () =>
            new TemplatingBuilderError({
              code: "not_found",
              message: "Git object not found.",
            })
        )
      );
    return downloaded.body;
  });

export const putBlob = (workspaceId: string, content: Uint8Array | string) => {
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  return putRaw(workspaceId, "blob", bytes);
};

export const getBlob = (workspaceId: string, objectId: string) =>
  getRaw(workspaceId, objectId);

export const putTree = (workspaceId: string, tree: GitTree) =>
  putRaw(workspaceId, "tree", encodeJson(tree));

export const getTree = (workspaceId: string, objectId: string) =>
  Effect.gen(function* () {
    const raw = yield* getRaw(workspaceId, objectId);
    return decodeJson<GitTree>(raw);
  });

export const putCommit = (workspaceId: string, commit: GitCommit) =>
  putRaw(workspaceId, "commit", encodeJson(commit));

export const getCommit = (workspaceId: string, objectId: string) =>
  Effect.gen(function* () {
    const raw = yield* getRaw(workspaceId, objectId);
    return decodeJson<GitCommit>(raw);
  });
