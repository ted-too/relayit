import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactEmailRenderProps, ReactEmailRenderResult } from "./types";

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Render a sealed React Email ESM artifact in a short-lived subprocess isolate.
 */
export async function renderSealedReactEmailArtifact(input: {
  artifact: Uint8Array | string;
  props?: ReactEmailRenderProps;
  subjectOverride?: string;
  timeoutMs?: number;
}): Promise<ReactEmailRenderResult> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "relayit-react-email-")
  );
  const artifactPath = path.join(tempDir, "artifact.mjs");

  try {
    const bytes =
      typeof input.artifact === "string"
        ? new TextEncoder().encode(input.artifact)
        : input.artifact;
    await fs.writeFile(artifactPath, bytes);

    const runner = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "isolate-runner.ts"
    );
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const args = [runner, artifactPath, JSON.stringify(input.props ?? {})];
    if (input.subjectOverride !== undefined) {
      args.push(input.subjectOverride);
    }

    const proc = Bun.spawn(["bun", ...args], {
      cwd: path.dirname(runner),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Keep the isolate lean — no inherited network knobs required.
      },
    });

    const timedOut = await Promise.race([
      proc.exited.then(() => false),
      Bun.sleep(timeoutMs).then(() => true),
    ]);

    if (timedOut) {
      proc.kill();
      return {
        ok: false,
        error: {
          code: "timeout",
          message: `Sealed artifact render timed out after ${timeoutMs}ms`,
        },
      };
    }

    const stdout = await new Response(proc.stdout).text();
    const line = stdout.trim().split("\n").filter(Boolean).at(-1);

    if (!line) {
      const stderr = await new Response(proc.stderr).text();
      return {
        ok: false,
        error: {
          code: "render_failed",
          message:
            stderr.trim() || "Sealed artifact isolate produced no output",
        },
      };
    }

    try {
      return JSON.parse(line) as ReactEmailRenderResult;
    } catch {
      return {
        ok: false,
        error: {
          code: "render_failed",
          message: "Sealed artifact isolate returned invalid JSON",
        },
      };
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
