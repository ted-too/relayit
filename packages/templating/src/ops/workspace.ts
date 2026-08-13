import { Effect } from "effect";
import { syncWorkspaceEntriesFromPaths } from "../entries";
import {
  getRef,
  commitFiles as gitCommitFiles,
  HOSTED_DEV_REF,
  listFilesAtRef,
  readFileAtRef,
  scaffoldHostedWorkspace,
  withWorkspaceGitLock,
} from "../git";
import { normalizeWorkspacePath } from "../paths";
import {
  depsSyncHostedWorkspace,
  previewHostedWorkspaceEntry,
  publishHostedWorkspace,
} from "../publish";
import { assertHardenedPackageJson } from "../publish/package-json";
import { TemplatingBuilderError } from "../rpc/errors";

/** Scaffold `dev` if missing; sync entry rows after first scaffold. */
export const ensureScaffolded = (input: { readonly workspaceId: string }) =>
  Effect.gen(function* () {
    const tip = yield* getRef(input.workspaceId, HOSTED_DEV_REF);
    if (tip) {
      return { commitSha: tip };
    }

    return yield* withWorkspaceGitLock(
      input.workspaceId,
      Effect.gen(function* () {
        const again = yield* getRef(input.workspaceId, HOSTED_DEV_REF);
        if (again) {
          return { commitSha: again };
        }

        const scaffolded = yield* scaffoldHostedWorkspace(input.workspaceId);
        const listed = yield* listFilesAtRef({
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });
        yield* syncWorkspaceEntriesFromPaths(input.workspaceId, listed.paths);
        return scaffolded;
      })
    );
  });

export const listFiles = (input: {
  readonly ref?: string;
  readonly workspaceId: string;
}) =>
  Effect.gen(function* () {
    const ref = input.ref ?? HOSTED_DEV_REF;
    if (ref === HOSTED_DEV_REF) {
      yield* ensureScaffolded({ workspaceId: input.workspaceId });
    }

    const listed = yield* listFilesAtRef({
      ref,
      workspaceId: input.workspaceId,
    });
    return {
      commitSha: listed.commitSha,
      paths: listed.paths,
      ref,
    };
  });

export const readFile = (input: {
  readonly path: string;
  readonly ref?: string;
  readonly workspaceId: string;
}) =>
  Effect.gen(function* () {
    const path = normalizeWorkspacePath(input.path);
    if (!path) {
      return yield* new TemplatingBuilderError({
        code: "invalid",
        message: "Invalid workspace path.",
      });
    }
    const ref = input.ref ?? HOSTED_DEV_REF;
    const read = yield* readFileAtRef({
      path,
      ref,
      workspaceId: input.workspaceId,
    });
    return {
      commitSha: read.commitSha,
      content: read.content,
      path,
      ref,
    };
  });

export const commitFiles = (input: {
  readonly changes: Record<string, string | null>;
  readonly message?: string;
  readonly workspaceId: string;
}) =>
  Effect.gen(function* () {
    const normalized: Record<string, string | null> = {};
    for (const [rawPath, content] of Object.entries(input.changes)) {
      const path = normalizeWorkspacePath(rawPath);
      if (!path) {
        return yield* new TemplatingBuilderError({
          code: "invalid",
          message: "Invalid workspace path.",
        });
      }
      if (path === "bun.lock" || path === "bun.lockb") {
        return yield* new TemplatingBuilderError({
          code: "invalid",
          message:
            "Lockfile is platform-owned; use deps sync instead of editing it.",
        });
      }
      if (path === "package.json" && content !== null) {
        yield* assertHardenedPackageJson(content);
      }
      normalized[path] = content;
    }

    return yield* withWorkspaceGitLock(
      input.workspaceId,
      Effect.gen(function* () {
        const committed = yield* gitCommitFiles({
          changes: normalized,
          message: input.message ?? "chore: update workspace files",
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });

        const listed = yield* listFilesAtRef({
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });
        yield* syncWorkspaceEntriesFromPaths(input.workspaceId, listed.paths);

        return { commitSha: committed.commitSha };
      })
    );
  });

export const depsSync = (input: { readonly workspaceId: string }) =>
  depsSyncHostedWorkspace(input);

export const publish = (input: { readonly workspaceId: string }) =>
  publishHostedWorkspace(input);

export const preview = (input: {
  readonly entryId: string;
  readonly props?: Record<string, unknown>;
  readonly subjectOverride?: string;
  readonly workspaceId: string;
}) => previewHostedWorkspaceEntry(input);
