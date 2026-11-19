import * as NodePath from "node:path";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";
import { isInDirectory, workspaceToolOutput } from "./tool-output";

/** Bundle a React Email entry into a sealed ESM artifact. */
export const bundleReactEmailEntry = (input: { entryPath: string; workspaceDir: string }) =>
  Effect.gen(function* () {
    const abs = NodePath.join(input.workspaceDir, input.entryPath);
    // Isolate host provides a single React instance. React Email packages are
    // sealed into the artifact — Bun cannot resolve bare `@react-email/*` imports
    // from the ephemeral /tmp artifact path against the host package.
    const result = yield* Effect.tryPromise({
      // With `throw: false` a rejection is the bundler failing to run, not the source
      // failing to build: the host's, so it gets no `detail`.
      catch: () =>
        new TemplatingBuilderError({
          code: "failed",
          message: "Failed to bundle workspace entry.",
        }),
      try: () =>
        Bun.build({
          entrypoints: [abs],
          external: ["react", "react-dom", "react/jsx-runtime"],
          format: "esm",
          minify: false,
          sourcemap: "none",
          target: "bun",
          // A failed build answers with its logs rather than rejecting with them.
          throw: false,
        }),
    });

    if (!result.success) {
      return yield* new TemplatingBuilderError({
        code: "failed",
        // The bundler's messages, each with where in the workspace's source it points.
        // An import can reach a file outside the checkout, and the bundler's message
        // about one quotes it ('Expected "," but found "…"'), as its line does: such an
        // error is reported in fixed words. This keeps a host file out of an error only;
        // an import that succeeds still puts the file in the artifact (#143).
        detail: workspaceToolOutput(
          result.logs
            .filter((log) => log.level === "error")
            .map((log) =>
              log.position && isInDirectory(log.position.file, input.workspaceDir)
                ? `${log.position.file}:${log.position.line}:${log.position.column}: ${log.message}\n${log.position.lineText}`
                : "A file outside the workspace failed to build.",
            )
            .join("\n"),
          input.workspaceDir,
        ),
        message: "Failed to bundle workspace entry.",
      });
    }

    const artifact = result.outputs[0];
    if (!artifact) {
      return yield* new TemplatingBuilderError({
        code: "failed",
        message: "No bundle output for workspace entry.",
      });
    }

    return new Uint8Array(yield* Effect.promise(() => artifact.arrayBuffer()));
  });
