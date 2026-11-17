import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { runBunInstall } from "../publish/bun-install";
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
      try: () => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-scaffold-")),
    }),
    (tempDir) => Effect.promise(() => NodeFSP.rm(tempDir, { force: true, recursive: true })),
  ).pipe(
    Effect.flatMap((tempDir) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to generate starter lockfile.",
            }),
          try: () => NodeFSP.writeFile(NodePath.join(tempDir, "package.json"), packageJson),
        });

        const install = yield* runBunInstall({
          args: ["--lockfile-only", "--ignore-scripts"],
          cwd: tempDir,
          operation: "scaffold",
        });
        if (!install.ok) {
          return yield* new TemplatingBuilderError({
            code: "failed",
            message: "Failed to generate starter lockfile.",
          });
        }

        return yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to generate starter lockfile.",
            }),
          try: () => NodeFSP.readFile(NodePath.join(tempDir, "bun.lock"), "utf8"),
        });
      }),
    ),
    Effect.scoped,
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
