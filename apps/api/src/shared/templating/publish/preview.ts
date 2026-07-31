import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { db } from "@repo/api/db";
import { createGenericError, type Result } from "@repo/api/utils";
import { renderSealedReactEmailArtifact } from "@repo/template-render/react-email";
import type { RedisClient } from "bun";
import {
  checkoutRefToDirectory,
  HOSTED_DEV_REF,
  withWorkspaceGitLock,
} from "../git";
import { bundleReactEmailEntry } from "./bundle";
import { assertHardenedPackageJson } from "./package-json";

export interface PreviewResult {
  commitSha: string;
  html: string;
  subject: string;
  text?: string;
  /** Resolved props after merging Entry `PreviewProps` under the request props. */
  props: Record<string, unknown>;
}

/**
 * Ephemeral seal+render of a Workspace Entry from `dev` without advancing
 * `main` or writing live artifacts.
 */
export function previewHostedWorkspaceEntry(input: {
  workspaceId: string;
  entryId: string;
  redis: RedisClient;
  props?: Record<string, unknown>;
  subjectOverride?: string;
}): Promise<Result<PreviewResult>> {
  return withWorkspaceGitLock(input.redis, input.workspaceId, async () => {
    const entry = await db.query.templatingWorkspaceEntry.findFirst({
      where: (table, { eq: equals, and: combine, isNull }) =>
        combine(
          equals(table.id, input.entryId),
          equals(table.workspaceId, input.workspaceId),
          isNull(table.deletedAt)
        ),
    });

    if (!entry) {
      return {
        error: createGenericError("Workspace Entry not found"),
        data: null,
      };
    }

    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "relayit-preview-")
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
        return {
          error: createGenericError("Preview install failed", [stderr]),
          data: null,
        };
      }

      const bundled = await bundleReactEmailEntry({
        workspaceDir: tempDir,
        entryPath: entry.path,
      });
      if (bundled.error || !bundled.data) {
        return { error: bundled.error, data: null };
      }

      const rendered = await renderSealedReactEmailArtifact({
        artifact: bundled.data,
        props: input.props ?? {},
        subjectOverride: input.subjectOverride,
        // Preview only — never merge PreviewProps on the send path.
        mergePreviewProps: true,
      });
      if (!rendered.ok) {
        return {
          error: createGenericError(rendered.error.message),
          data: null,
        };
      }

      return {
        error: null,
        data: {
          html: rendered.value.html,
          subject: rendered.value.subject,
          ...(rendered.value.text === undefined
            ? {}
            : { text: rendered.value.text }),
          props: rendered.value.props,
          commitSha: checkedOut.data.commitSha,
        },
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}
