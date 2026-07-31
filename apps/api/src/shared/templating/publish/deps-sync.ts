import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createGenericError, type Result } from "@repo/api/utils";
import type { RedisClient } from "bun";
import {
  checkoutRefToDirectory,
  commitFiles,
  HOSTED_DEV_REF,
  withWorkspaceGitLock,
} from "../git";
import { assertHardenedPackageJson } from "./package-json";

/**
 * Hardened install on `dev`: rewrite platform-owned lockfile from current
 * package.json without sealing artifacts.
 */
export function depsSyncHostedWorkspace(input: {
  workspaceId: string;
  redis: RedisClient;
}): Promise<Result<{ commitSha: string }>> {
  return withWorkspaceGitLock(input.redis, input.workspaceId, async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relayit-deps-"));
    try {
      const checkedOut = await checkoutRefToDirectory({
        workspaceId: input.workspaceId,
        ref: HOSTED_DEV_REF,
        destDir: tempDir,
      });
      if (checkedOut.error) {
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

      const proc = Bun.spawn(["bun", "install", "--ignore-scripts"], {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          BUN_INSTALL_IGNORE_SCRIPTS: "1",
        },
      });
      const exit = await proc.exited;
      if (exit !== 0) {
        const stderr = await new Response(proc.stderr).text();
        return {
          error: createGenericError("Deps sync install failed", [stderr]),
          data: null,
        };
      }

      const lockPath = path.join(tempDir, "bun.lock");
      try {
        await fs.access(lockPath);
      } catch {
        return {
          error: createGenericError("Deps sync did not produce bun.lock"),
          data: null,
        };
      }

      const lockfile = await fs.readFile(lockPath, "utf8");
      return commitFiles({
        workspaceId: input.workspaceId,
        ref: HOSTED_DEV_REF,
        message: "chore: deps sync",
        changes: { "bun.lock": lockfile },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}
