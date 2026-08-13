import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import {
  checkoutRefToDirectory,
  commitFiles,
  HOSTED_DEV_REF,
  withWorkspaceGitLock,
} from "../git";
import { TemplatingBuilderError } from "../rpc/errors";
import { assertHardenedPackageJson } from "./package-json";

/**
 * Hardened install on `dev`: rewrite platform-owned lockfile from current
 * package.json without sealing artifacts.
 */
export const depsSyncHostedWorkspace = (input: { workspaceId: string }) =>
  withWorkspaceGitLock(
    input.workspaceId,
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = yield* Effect.acquireRelease(
          Effect.tryPromise({
            catch: () =>
              new TemplatingBuilderError({
                code: "failed",
                message: "Failed to create deps-sync temp directory.",
              }),
            try: () => fs.mkdtemp(path.join(os.tmpdir(), "relayit-deps-")),
          }),
          (dir) =>
            Effect.promise(() => fs.rm(dir, { force: true, recursive: true }))
        );

        yield* checkoutRefToDirectory({
          destDir: tempDir,
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });

        const packageJson = yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to read package.json.",
            }),
          try: () => fs.readFile(path.join(tempDir, "package.json"), "utf8"),
        });
        yield* assertHardenedPackageJson(packageJson);

        yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Deps sync install failed.",
            }),
          try: async () => {
            const proc = Bun.spawn(["bun", "install", "--ignore-scripts"], {
              cwd: tempDir,
              env: {
                ...process.env,
                BUN_INSTALL_IGNORE_SCRIPTS: "1",
              },
              stderr: "pipe",
              stdout: "pipe",
            });
            const exit = await proc.exited;
            if (exit !== 0) {
              throw new Error("install failed");
            }
          },
        });

        const lockPath = path.join(tempDir, "bun.lock");
        const lockfile = yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Deps sync did not produce bun.lock.",
            }),
          try: () => fs.readFile(lockPath, "utf8"),
        });

        return yield* commitFiles({
          changes: { "bun.lock": lockfile },
          message: "chore: deps sync",
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });
      })
    )
  );
