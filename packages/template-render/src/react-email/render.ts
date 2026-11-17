import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import type { ReactEmailRenderProps, ReactEmailRenderResult } from "./types";

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Render a sealed React Email ESM artifact in a short-lived subprocess isolate.
 * `subject` is required — supplied by the Template variant / request, not Entry source.
 *
 * When `mergePreviewProps` is true (preview only), the isolate merges
 * `default.PreviewProps` under caller props — never enable this on send.
 */
export async function renderSealedReactEmailArtifact(input: {
  artifact: Uint8Array | string;
  props?: ReactEmailRenderProps;
  /** @deprecated Prefer `subject`. */
  subjectOverride?: string;
  subject?: string;
  mergePreviewProps?: boolean;
  timeoutMs?: number;
}): Promise<ReactEmailRenderResult> {
  const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-react-email-"));
  const artifactPath = NodePath.join(tempDir, "artifact.mjs");

  try {
    const bytes =
      typeof input.artifact === "string"
        ? new TextEncoder().encode(input.artifact)
        : input.artifact;
    await NodeFSP.writeFile(artifactPath, bytes);

    const runner = NodePath.join(
      NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
      "isolate-runner.ts",
    );
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const subject = input.subject ?? input.subjectOverride ?? "";
    const args = [runner, artifactPath, JSON.stringify(input.props ?? {}), subject];

    const proc = Bun.spawn(["bun", ...args], {
      cwd: NodePath.dirname(runner),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        RELAYIT_MERGE_PREVIEW_PROPS: input.mergePreviewProps ? "1" : "0",
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
    const line = stdout.trim().split("\n").findLast(Boolean);

    if (!line) {
      const stderr = await new Response(proc.stderr).text();
      return {
        ok: false,
        error: {
          code: "render_failed",
          message: stderr.trim() || "Sealed artifact isolate produced no output",
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
    await NodeFSP.rm(tempDir, { recursive: true, force: true });
  }
}
