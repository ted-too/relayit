import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";
import { commitFiles, listFilesAtRef, readFileAtRef } from "./commit";
import { getRef, updateRef } from "./refs";
import { HOSTED_DEV_REF, HOSTED_MAIN_REF } from "./types";

const STARTER_PACKAGE_JSON = `{
  "name": "relayit-email-workspace",
  "private": true,
  "type": "module",
  "dependencies": {
    "@react-email/components": "^0.5.3",
    "react": "^19.2.6",
    "react-dom": "^19.2.6"
  }
}
`;

const STARTER_ENTRY = `import * as React from "react";
import { Html, Body, Text } from "@react-email/components";

export type Props = {
  name: string;
};

export default function WelcomeEmail({ name }: Props) {
  return (
    <Html>
      <Body>
        <Text>Welcome, {name}!</Text>
      </Body>
    </Html>
  );
}
`;

const generateLockfile = (packageJson: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      catch: () =>
        new TemplatingBuilderError({
          code: "failed",
          message: "Failed to create scaffold temp directory.",
        }),
      try: () => fs.mkdtemp(path.join(os.tmpdir(), "relayit-scaffold-")),
    }),
    (tempDir) =>
      Effect.promise(() => fs.rm(tempDir, { force: true, recursive: true }))
  ).pipe(
    Effect.flatMap((tempDir) =>
      Effect.tryPromise({
        catch: () =>
          new TemplatingBuilderError({
            code: "failed",
            message: "Failed to generate starter lockfile.",
          }),
        try: async () => {
          await fs.writeFile(path.join(tempDir, "package.json"), packageJson);
          const proc = Bun.spawn(
            ["bun", "install", "--lockfile-only", "--ignore-scripts"],
            {
              cwd: tempDir,
              env: {
                ...process.env,
                BUN_INSTALL_IGNORE_SCRIPTS: "1",
              },
              stderr: "pipe",
              stdout: "pipe",
            }
          );
          const exit = await proc.exited;
          if (exit !== 0) {
            throw new Error("bun install failed");
          }

          const lockPath = path.join(tempDir, "bun.lock");
          try {
            await fs.access(lockPath);
            return await fs.readFile(lockPath, "utf8");
          } catch {
            throw new Error("No bun.lock produced");
          }
        },
      })
    ),
    Effect.scoped
  );

/**
 * Seed hosted `dev` + `main` like the old API `getOrCreateHostedWorkspace`.
 * If `dev` already exists but is missing `package.json` / `bun.lock` (a
 * create-new commit that raced ahead of scaffold), restore those files.
 * Caller must hold the workspace Git lock.
 */
export const scaffoldHostedWorkspace = (workspaceId: string) =>
  Effect.gen(function* () {
    const existing = yield* getRef(workspaceId, HOSTED_DEV_REF);
    if (existing) {
      const listed = yield* listFilesAtRef({
        ref: HOSTED_DEV_REF,
        workspaceId,
      });
      const hasPackage = listed.paths.includes("package.json");
      const hasLock = listed.paths.includes("bun.lock");
      if (hasPackage && hasLock) {
        return { commitSha: existing };
      }

      let packageJson = STARTER_PACKAGE_JSON;
      if (hasPackage) {
        const current = yield* readFileAtRef({
          path: "package.json",
          ref: HOSTED_DEV_REF,
          workspaceId,
        });
        packageJson = current.content;
      }
      const changes: Record<string, string> = {};
      if (!hasPackage) {
        changes["package.json"] = STARTER_PACKAGE_JSON;
      }
      if (!hasLock) {
        changes["bun.lock"] = yield* generateLockfile(packageJson);
      }

      const restored = yield* commitFiles({
        changes,
        message: "chore: restore workspace package manifest",
        ref: HOSTED_DEV_REF,
        workspaceId,
      });
      return { commitSha: restored.commitSha };
    }

    const lockfile = yield* generateLockfile(STARTER_PACKAGE_JSON);

    const committed = yield* commitFiles({
      changes: {
        "bun.lock": lockfile,
        "package.json": STARTER_PACKAGE_JSON,
        "reactEmail/welcome.tsx": STARTER_ENTRY,
      },
      message: "chore: scaffold React Email workspace",
      ref: HOSTED_DEV_REF,
      workspaceId,
    });

    // main starts equal to first successful tip; Publish advances it later.
    yield* updateRef({
      expectedSha: null,
      name: HOSTED_MAIN_REF,
      sha: committed.commitSha,
      workspaceId,
    });

    return { commitSha: committed.commitSha };
  });
