import { createGenericError, type Result } from "@repo/api/utils";
import { templatingGitObjectClient } from "../storage";
import { decodeJson, encodeJson, hashObject } from "./hash";
import type { GitCommit, GitObjectType, GitTree } from "./types";

async function putRaw(
  workspaceId: string,
  type: GitObjectType,
  content: Uint8Array
): Promise<Result<string>> {
  const objectId = hashObject(type, content);
  const uploaded = await templatingGitObjectClient.upload(
    { workspaceId, objectId },
    content,
    { contentType: "application/octet-stream", metadata: { type } }
  );

  if (uploaded.error) {
    return { error: uploaded.error, data: null };
  }

  return { error: null, data: objectId };
}

async function getRaw(
  workspaceId: string,
  objectId: string
): Promise<Result<Uint8Array>> {
  const downloaded = await templatingGitObjectClient.download({
    workspaceId,
    objectId,
  });

  if (downloaded.error || !downloaded.data) {
    return {
      error:
        downloaded.error ??
        createGenericError(`Git object not found: ${objectId}`),
      data: null,
    };
  }

  return { error: null, data: downloaded.data.body };
}

export function putBlob(
  workspaceId: string,
  content: Uint8Array | string
): Promise<Result<string>> {
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  return putRaw(workspaceId, "blob", bytes);
}

export function getBlob(
  workspaceId: string,
  objectId: string
): Promise<Result<Uint8Array>> {
  return getRaw(workspaceId, objectId);
}

export function putTree(
  workspaceId: string,
  tree: GitTree
): Promise<Result<string>> {
  return putRaw(workspaceId, "tree", encodeJson(tree));
}

export async function getTree(
  workspaceId: string,
  objectId: string
): Promise<Result<GitTree>> {
  const raw = await getRaw(workspaceId, objectId);
  if (raw.error || !raw.data) {
    return {
      error: raw.error ?? createGenericError("Missing tree"),
      data: null,
    };
  }
  return { error: null, data: decodeJson<GitTree>(raw.data) };
}

export function putCommit(
  workspaceId: string,
  commit: GitCommit
): Promise<Result<string>> {
  return putRaw(workspaceId, "commit", encodeJson(commit));
}

export async function getCommit(
  workspaceId: string,
  objectId: string
): Promise<Result<GitCommit>> {
  const raw = await getRaw(workspaceId, objectId);
  if (raw.error || !raw.data) {
    return {
      error: raw.error ?? createGenericError("Missing commit"),
      data: null,
    };
  }
  return { error: null, data: decodeJson<GitCommit>(raw.data) };
}
