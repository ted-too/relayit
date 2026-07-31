import { env } from "@repo/api/env";
import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import type { PublishResult } from "../publish";
import {
  type BuilderCommitResult,
  type BuilderFileList,
  type BuilderFileRead,
  builderCommitFiles,
  builderDepsSync,
  builderListFiles,
  builderPublish,
  builderReadFile,
} from "./ops";

async function callBuilderHttp<T>(
  path: string,
  init?: RequestInit
): Promise<Result<T>> {
  const base = env.TEMPLATING_BUILDER_URL;
  if (!base) {
    return {
      error: createGenericError("TEMPLATING_BUILDER_URL is not configured"),
      data: null,
    };
  }

  try {
    const response = await fetch(new URL(path, base), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(env.TEMPLATING_BUILDER_SECRET
          ? { authorization: `Bearer ${env.TEMPLATING_BUILDER_SECRET}` }
          : {}),
        ...(init?.headers ?? {}),
      },
    });

    const body = (await response.json()) as {
      error?: string;
      details?: string[];
      data?: T;
    };

    if (!response.ok) {
      return {
        error: createGenericError(
          body.error ?? `Builder request failed (${response.status})`,
          body.details
        ),
        data: null,
      };
    }

    return { error: null, data: body.data as T };
  } catch (error) {
    return {
      error: createGenericError("Failed to reach templating-builder", error),
      data: null,
    };
  }
}

function isRemoteBuilderConfigured() {
  return Boolean(env.TEMPLATING_BUILDER_URL);
}

/** List files at a ref (default `dev`). */
export function templatingListFiles(input: {
  workspaceId: string;
  ref?: string;
  redis: RedisClient;
}): Promise<Result<BuilderFileList>> {
  if (isRemoteBuilderConfigured()) {
    const qs = new URLSearchParams({ workspaceId: input.workspaceId });
    if (input.ref) {
      qs.set("ref", input.ref);
    }
    return callBuilderHttp(`/internal/files?${qs}`);
  }
  return builderListFiles(input);
}

export function templatingReadFile(input: {
  workspaceId: string;
  path: string;
  ref?: string;
  redis: RedisClient;
}): Promise<Result<BuilderFileRead>> {
  if (isRemoteBuilderConfigured()) {
    const qs = new URLSearchParams({
      workspaceId: input.workspaceId,
      path: input.path,
    });
    if (input.ref) {
      qs.set("ref", input.ref);
    }
    return callBuilderHttp(`/internal/file?${qs}`);
  }
  return builderReadFile(input);
}

export function templatingCommitFiles(input: {
  workspaceId: string;
  redis: RedisClient;
  message?: string;
  changes: Record<string, string | null>;
}): Promise<Result<BuilderCommitResult>> {
  if (isRemoteBuilderConfigured()) {
    return callBuilderHttp("/internal/commit", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        message: input.message,
        changes: input.changes,
      }),
    });
  }
  return builderCommitFiles(input);
}

export function templatingDepsSync(input: {
  workspaceId: string;
  redis: RedisClient;
}): Promise<Result<{ commitSha: string }>> {
  if (isRemoteBuilderConfigured()) {
    return callBuilderHttp("/internal/deps-sync", {
      method: "POST",
      body: JSON.stringify({ workspaceId: input.workspaceId }),
    });
  }
  return builderDepsSync(input);
}

export function templatingPublish(input: {
  workspaceId: string;
  redis: RedisClient;
}): Promise<Result<PublishResult>> {
  if (isRemoteBuilderConfigured()) {
    return callBuilderHttp("/internal/publish", {
      method: "POST",
      body: JSON.stringify({ workspaceId: input.workspaceId }),
    });
  }
  return builderPublish(input);
}
