import * as path from "node:path";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";

/** Bundle a React Email entry into a sealed ESM artifact. */
export const bundleReactEmailEntry = (input: {
  entryPath: string;
  workspaceDir: string;
}) =>
  Effect.gen(function* () {
    const abs = path.join(input.workspaceDir, input.entryPath);
    // Isolate host provides a single React instance. React Email packages are
    // sealed into the artifact — Bun cannot resolve bare `@react-email/*` imports
    // from the ephemeral /tmp artifact path against the host package.
    const result = yield* Effect.tryPromise({
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
        }),
    });

    if (!result.success) {
      return yield* new TemplatingBuilderError({
        code: "failed",
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
