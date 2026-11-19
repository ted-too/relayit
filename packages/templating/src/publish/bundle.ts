import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";
import { workspaceToolOutput } from "./tool-output";

/** Bundle a React Email entry into a sealed ESM artifact. */
export const bundleReactEmailEntry = (input: { entryPath: string; workspaceDir: string }) =>
  Effect.gen(function* () {
    const failed = new TemplatingBuilderError({
      code: "failed",
      message: "Failed to bundle workspace entry.",
    });
    const runnerDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

    const stdout = yield* Effect.tryPromise({
      catch: () => failed,
      try: async () => {
        const proc = Bun.spawn(
          [
            "bun",
            NodePath.join(runnerDir, "bundle-runner.ts"),
            input.workspaceDir,
            input.entryPath,
          ],
          {
            // Not the checkout: Bun reads a `bunfig.toml` and `.env` from where it starts.
            cwd: runnerDir,
            // The bundler reads a customer's source, so it is handed nothing of the
            // builder's environment: PATH to find bun, and NODE_ENV, which the bundle of a
            // dependency that branches on it follows.
            env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH },
            stderr: "ignore",
            stdout: "pipe",
          },
        );
        const [text] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        return text;
      },
    });

    // The runner always answers one JSON line. Anything else is the bundler failing to
    // run, not the source failing to build: the host's, so it gets no `detail`.
    const answer = yield* Effect.try({
      catch: () => failed,
      try: () =>
        JSON.parse(stdout) as { artifact: string; ok: true } | { detail: string; ok: false },
    });

    if (!answer.ok) {
      return yield* new TemplatingBuilderError({
        code: "failed",
        detail: workspaceToolOutput(answer.detail, input.workspaceDir),
        message: "Failed to bundle workspace entry.",
      });
    }

    return new Uint8Array(Buffer.from(answer.artifact, "base64"));
  });
