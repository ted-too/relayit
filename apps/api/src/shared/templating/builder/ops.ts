import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import { syncWorkspaceEntriesFromPaths } from "../entries";
import {
  commitFiles,
  HOSTED_DEV_REF,
  listFilesAtRef,
  readFileAtRef,
  withWorkspaceGitLock,
} from "../git";
import { normalizeWorkspacePath } from "../paths";
import {
  depsSyncHostedWorkspace,
  type PublishResult,
  publishHostedWorkspace,
} from "../publish";
import { assertHardenedPackageJson } from "../publish/package-json";

export interface BuilderFileList {
  commitSha: string;
  paths: string[];
  ref: string;
}

export interface BuilderFileRead {
  commitSha: string;
  content: string;
  path: string;
  ref: string;
}

export interface BuilderCommitResult {
  commitSha: string;
}

/**
 * Sole Git mutator surface used by the templating-builder process and
 * in-process API fallback when `TEMPLATING_BUILDER_URL` is unset.
 */
export async function builderListFiles(input: {
  workspaceId: string;
  ref?: string;
}): Promise<Result<BuilderFileList>> {
  const ref = input.ref ?? HOSTED_DEV_REF;
  const listed = await listFilesAtRef({
    workspaceId: input.workspaceId,
    ref,
  });
  if (listed.error || !listed.data) {
    return {
      error:
        listed.error ?? createGenericError(`Failed to list files at ${ref}`),
      data: null,
    };
  }
  return {
    error: null,
    data: {
      ref,
      commitSha: listed.data.commitSha,
      paths: listed.data.paths,
    },
  };
}

export async function builderReadFile(input: {
  workspaceId: string;
  path: string;
  ref?: string;
}): Promise<Result<BuilderFileRead>> {
  const path = normalizeWorkspacePath(input.path);
  if (!path) {
    return {
      error: createGenericError("Invalid workspace path"),
      data: null,
    };
  }
  const ref = input.ref ?? HOSTED_DEV_REF;
  const read = await readFileAtRef({
    workspaceId: input.workspaceId,
    ref,
    path,
  });
  if (read.error || !read.data) {
    return {
      error: read.error ?? createGenericError(`File not found: ${path}`),
      data: null,
    };
  }
  return {
    error: null,
    data: {
      ref,
      path,
      commitSha: read.data.commitSha,
      content: read.data.content,
    },
  };
}

export function builderCommitFiles(input: {
  workspaceId: string;
  redis: RedisClient;
  message?: string;
  changes: Record<string, string | null>;
}): Promise<Result<BuilderCommitResult>> {
  const normalized: Record<string, string | null> = {};
  for (const [rawPath, content] of Object.entries(input.changes)) {
    const path = normalizeWorkspacePath(rawPath);
    if (!path) {
      return Promise.resolve({
        error: createGenericError(`Invalid workspace path: ${rawPath}`),
        data: null,
      });
    }
    if (path === "bun.lock" || path === "bun.lockb") {
      return Promise.resolve({
        error: createGenericError(
          "Lockfile is platform-owned; use deps sync instead of editing it"
        ),
        data: null,
      });
    }
    if (path === "package.json" && content !== null) {
      const hardened = assertHardenedPackageJson(content);
      if (hardened.error) {
        return Promise.resolve({ error: hardened.error, data: null });
      }
    }
    normalized[path] = content;
  }

  return withWorkspaceGitLock(input.redis, input.workspaceId, async () => {
    const committed = await commitFiles({
      workspaceId: input.workspaceId,
      ref: HOSTED_DEV_REF,
      message: input.message ?? "chore: update workspace files",
      changes: normalized,
    });
    if (committed.error || !committed.data) {
      return {
        error:
          committed.error ??
          createGenericError("Failed to commit workspace files"),
        data: null,
      };
    }

    const listed = await listFilesAtRef({
      workspaceId: input.workspaceId,
      ref: HOSTED_DEV_REF,
    });
    if (listed.error || !listed.data) {
      return {
        error:
          listed.error ??
          createGenericError("Failed to list files after commit"),
        data: null,
      };
    }

    await syncWorkspaceEntriesFromPaths(input.workspaceId, listed.data.paths);

    return { error: null, data: { commitSha: committed.data.commitSha } };
  });
}

export function builderDepsSync(input: {
  workspaceId: string;
  redis: RedisClient;
}): Promise<Result<{ commitSha: string }>> {
  return depsSyncHostedWorkspace(input);
}

export function builderPublish(input: {
  workspaceId: string;
  redis: RedisClient;
}): Promise<Result<PublishResult>> {
  return publishHostedWorkspace(input);
}
