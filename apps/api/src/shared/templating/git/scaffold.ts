import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createGenericError, type Result } from "@repo/api/utils";
import { commitFiles } from "./commit";
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

async function generateLockfile(): Promise<Result<{ lockfile: string }>> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relayit-scaffold-"));
  try {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      STARTER_PACKAGE_JSON
    );
    const proc = Bun.spawn(
      ["bun", "install", "--lockfile-only", "--ignore-scripts"],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          BUN_INSTALL_IGNORE_SCRIPTS: "1",
        },
      }
    );
    const exit = await proc.exited;
    if (exit !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        error: createGenericError("Failed to generate starter lockfile", [
          stderr,
        ]),
        data: null,
      };
    }

    const lockPath = path.join(tempDir, "bun.lock");
    const lockAlt = path.join(tempDir, "bun.lockb");
    if (await fileExists(lockPath)) {
      return {
        error: null,
        data: { lockfile: await fs.readFile(lockPath, "utf8") },
      };
    }
    if (await fileExists(lockAlt)) {
      // Store binary lock as base64-marked text is awkward; prefer text lock.
      return {
        error: createGenericError(
          "bun.lockb generated; expected bun.lock text lockfile"
        ),
        data: null,
      };
    }
    return {
      error: createGenericError("No lockfile produced by bun install"),
      data: null,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Seed hosted `dev` + `main` with a starter React Email workspace. */
export async function scaffoldHostedWorkspace(
  workspaceId: string
): Promise<Result<{ commitSha: string }>> {
  const existing = await getRef(workspaceId, HOSTED_DEV_REF);
  if (existing) {
    return { error: null, data: { commitSha: existing } };
  }

  const lock = await generateLockfile();
  if (lock.error || !lock.data) {
    return { error: lock.error, data: null };
  }

  const committed = await commitFiles({
    workspaceId,
    ref: HOSTED_DEV_REF,
    message: "chore: scaffold React Email workspace",
    changes: {
      "package.json": STARTER_PACKAGE_JSON,
      "bun.lock": lock.data.lockfile,
      "reactEmail/welcome.tsx": STARTER_ENTRY,
    },
  });

  if (committed.error || !committed.data) {
    return { error: committed.error, data: null };
  }

  // main starts equal to first successful tip; Publish advances it later.
  const main = await updateRef({
    workspaceId,
    name: HOSTED_MAIN_REF,
    sha: committed.data.commitSha,
    expectedSha: null,
  });
  if (main.error) {
    return { error: main.error, data: null };
  }

  return { error: null, data: { commitSha: committed.data.commitSha } };
}
