import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { db, schema } from "@repo/api/db";
import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import { eq } from "drizzle-orm";
import { syncWorkspaceEntriesForPaths } from "../entries";
import {
  checkoutRefToDirectory,
  getRef,
  HOSTED_DEV_REF,
  HOSTED_MAIN_REF,
  updateRef,
  withWorkspaceGitLock,
} from "../git";
import { isReactEmailEntryPath } from "../kinds/react-email/paths";
import { inferReactEmailPropsFromSource } from "../kinds/react-email/props";
import {
  newArtifactRevision,
  templatingArtifactClient,
  templatingArtifacts,
} from "../storage";
import { bundleReactEmailEntry } from "./bundle";
import { assertHardenedPackageJson } from "./package-json";

export interface PublishResult {
  commitSha: string;
  entries: Array<{ id: string; path: string; pickable: boolean }>;
}

/**
 * Publish hosted workspace: build from `dev`, seal artifacts, advance `main`
 * only on full success.
 */
export function publishHostedWorkspace(input: {
  workspaceId: string;
  redis: RedisClient;
}): Promise<Result<PublishResult>> {
  return withWorkspaceGitLock(input.redis, input.workspaceId, async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "relayit-publish-")
    );

    try {
      const checkedOut = await checkoutRefToDirectory({
        workspaceId: input.workspaceId,
        ref: HOSTED_DEV_REF,
        destDir: tempDir,
      });
      if (checkedOut.error || !checkedOut.data) {
        return { error: checkedOut.error, data: null };
      }

      const packageJson = await fs.readFile(
        path.join(tempDir, "package.json"),
        "utf8"
      );
      const hardened = assertHardenedPackageJson(packageJson);
      if (hardened.error) {
        await recordBuildError(input.workspaceId, hardened.error.message);
        return { error: hardened.error, data: null };
      }

      const install = Bun.spawn(
        ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
        {
          cwd: tempDir,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, BUN_INSTALL_IGNORE_SCRIPTS: "1" },
        }
      );
      if ((await install.exited) !== 0) {
        const stderr = await new Response(install.stderr).text();
        const error = createGenericError("Publish install failed", [stderr]);
        await recordBuildError(input.workspaceId, error.message);
        return { error, data: null };
      }

      const entryFiles = await collectEntryPaths(tempDir);
      if (entryFiles.length === 0) {
        const error = createGenericError(
          "No reactEmail/<slug>.tsx Workspace Entries to publish"
        );
        await recordBuildError(input.workspaceId, error.message);
        return { error, data: null };
      }

      await syncWorkspaceEntriesForPaths({
        workspaceId: input.workspaceId,
        entryPaths: entryFiles,
      });

      const entries = await db.query.templatingWorkspaceEntry.findMany({
        where: (table, { eq: equals, and: combine, isNull: isNullFn }) =>
          combine(
            equals(table.workspaceId, input.workspaceId),
            isNullFn(table.deletedAt)
          ),
      });

      const active = entries.filter((entry) =>
        isReactEmailEntryPath(entry.path)
      );
      const staged: Array<{
        entryId: string;
        path: string;
        artifact: Uint8Array;
        props: ReturnType<typeof inferReactEmailPropsFromSource>;
        revision: string;
      }> = [];

      for (const entry of active) {
        const source = await fs.readFile(
          path.join(tempDir, entry.path),
          "utf8"
        );
        const bundled = await bundleReactEmailEntry({
          workspaceDir: tempDir,
          entryPath: entry.path,
        });
        if (bundled.error || !bundled.data) {
          const error =
            bundled.error ??
            createGenericError(`Failed to bundle ${entry.path}`);
          await recordBuildError(input.workspaceId, error.message);
          return { error, data: null };
        }
        staged.push({
          entryId: entry.id,
          path: entry.path,
          artifact: bundled.data,
          props: inferReactEmailPropsFromSource(source),
          revision: newArtifactRevision(),
        });
      }

      const builtAt = new Date();
      const resultEntries: PublishResult["entries"] = [];

      for (const item of staged) {
        const uploaded = await templatingArtifactClient.upload(
          {
            workspaceId: input.workspaceId,
            entryId: item.entryId,
            revision: item.revision,
          },
          item.artifact,
          { contentType: "application/javascript" }
        );
        if (uploaded.error) {
          await recordBuildError(input.workspaceId, uploaded.error.message);
          return { error: uploaded.error, data: null };
        }

        const storageKey = templatingArtifacts.key({
          workspaceId: input.workspaceId,
          entryId: item.entryId,
          revision: item.revision,
        });

        await db
          .update(schema.templatingWorkspaceEntry)
          .set({
            artifactStorageKey: storageKey,
            artifactCommitSha: checkedOut.data.commitSha,
            inferredProps: item.props,
            builtAt,
            updatedAt: builtAt,
          })
          .where(eq(schema.templatingWorkspaceEntry.id, item.entryId));

        resultEntries.push({
          id: item.entryId,
          path: item.path,
          pickable: true,
        });
      }

      const previousMain = await getRef(input.workspaceId, HOSTED_MAIN_REF);
      const advanced = await updateRef({
        workspaceId: input.workspaceId,
        name: HOSTED_MAIN_REF,
        sha: checkedOut.data.commitSha,
        expectedSha: previousMain,
      });
      if (advanced.error) {
        await recordBuildError(input.workspaceId, advanced.error.message);
        return { error: advanced.error, data: null };
      }

      await db
        .update(schema.templatingWorkspace)
        .set({
          lastBuildAt: builtAt,
          lastBuildError: null,
          updatedAt: builtAt,
        })
        .where(eq(schema.templatingWorkspace.id, input.workspaceId));

      return {
        error: null,
        data: {
          commitSha: checkedOut.data.commitSha,
          entries: resultEntries,
        },
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}

async function recordBuildError(workspaceId: string, message: string) {
  await db
    .update(schema.templatingWorkspace)
    .set({
      lastBuildError: message,
      updatedAt: new Date(),
    })
    .where(eq(schema.templatingWorkspace.id, workspaceId));
}

async function collectEntryPaths(root: string): Promise<string[]> {
  const dir = path.join(root, "reactEmail");
  try {
    const names = await fs.readdir(dir);
    return names
      .map((name) => path.join("reactEmail", name))
      .filter((p) => isReactEmailEntryPath(p));
  } catch {
    return [];
  }
}
