import * as path from "node:path";
import { createGenericError, type Result } from "@repo/api/utils";

/** Bundle a React Email entry into a sealed ESM artifact. */
export async function bundleReactEmailEntry(input: {
  workspaceDir: string;
  entryPath: string;
}): Promise<Result<Uint8Array>> {
  const abs = path.join(input.workspaceDir, input.entryPath);
  // Isolate host provides React / React Email runtime — keep one React instance.
  const result = await Bun.build({
    entrypoints: [abs],
    target: "bun",
    format: "esm",
    minify: false,
    sourcemap: "none",
    external: ["react", "react-dom", "react/jsx-runtime", "@react-email/*"],
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
