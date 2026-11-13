import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { checkoutRefToDirectory, commitFiles, HOSTED_DEV_REF, withWorkspaceGitLock } from "../git";
import { TemplatingBuilderError } from "../rpc/errors";
import { runBunInstall } from "./bun-install";
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
            try: () => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-deps-")),
          }),
          (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
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
          try: () => NodeFSP.readFile(NodePath.join(tempDir, "package.json"), "utf8"),
        });
        yield* assertHardenedPackageJson(packageJson);

        const install = yield* runBunInstall({
          args: ["--ignore-scripts"],
          cwd: tempDir,
          operation: "deps-sync",
        });
        if (!install.ok) {
          return yield* new TemplatingBuilderError({
            code: "failed",
            message: "Deps sync install failed.",
          });
        }

        const lockPath = NodePath.join(tempDir, "bun.lock");
        const lockfile = yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Deps sync did not produce bun.lock.",
            }),
          try: () => NodeFSP.readFile(lockPath, "utf8"),
        });

        return yield* commitFiles({
          changes: { "bun.lock": lockfile },
          message: "chore: deps sync",
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });
      }),
    ),
  );
