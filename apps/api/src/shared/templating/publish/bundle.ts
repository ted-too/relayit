import * as path from "node:path";
import { createGenericError, type Result } from "@repo/api/utils";

/** Bundle a React Email entry into a sealed ESM artifact. */
export async function bundleReactEmailEntry(input: {
  workspaceDir: string;
  entryPath: string;
}): Promise<Result<Uint8Array>> {
  const abs = path.join(input.workspaceDir, input.entryPath);
  // Isolate host provides a single React instance. React Email packages are
  // sealed into the artifact — Bun cannot resolve bare `@react-email/*` imports
  // from the ephemeral /tmp artifact path against the host package.
  const result = await Bun.build({
    entrypoints: [abs],
    target: "bun",
    format: "esm",
    minify: false,
    sourcemap: "none",
    external: ["react", "react-dom", "react/jsx-runtime"],
  });

  if (!result.success) {
    return {
      error: createGenericError(
        `Failed to bundle ${input.entryPath}`,
        result.logs.map((log) => log.message ?? String(log))
      ),
      data: null,
    };
  }

  const artifact = result.outputs[0];
  if (!artifact) {
    return {
      error: createGenericError(`No bundle output for ${input.entryPath}`),
      data: null,
    };
  }

  const bytes = new Uint8Array(await artifact.arrayBuffer());
  return { error: null, data: bytes };
}
