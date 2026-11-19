/**
 * CLI entry for the short-lived process that bundles one Workspace Entry.
 * Args: <workspaceDir> <entryPath>
 * Prints a single JSON line to stdout: the artifact, or why the source did not build.
 *
 * A workspace's source is a customer's. Bundling it must not run it, and must not read
 * anything of the host into the artifact, so this process is the only one that touches
 * it: it is given no environment worth reading, runs no macro, and loads no file from
 * outside the checkout.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const OUTSIDE_WORKSPACE = "An import reaches outside the workspace.";

const [workspaceArg, entryPath] = process.argv.slice(2);
if (!(workspaceArg && entryPath)) {
  // No JSON line: the caller reads that as the host's failure, which it is.
  process.exit(2);
}
// The real path, which is how the bundler names the files it loads.
const workspaceDir = NodeFS.realpathSync(workspaceArg);
const inWorkspace = (path: string) => path.startsWith(`${workspaceDir}/`);

// Not an inline argument: `macros` is missing from Bun's types, and an object literal
// would be refused for it. It is what `bun build --no-macros` sets; the runtime flag and
// bunfig's `macros = false` do not reach `Bun.build`. A bundle-time macro is the
// workspace's code run here, so the macro test in workspace.integration.test.ts holds a
// Bun upgrade to this still working.
const config = {
  entrypoints: [NodePath.join(workspaceDir, entryPath)],
  // The render isolate provides a single React instance. React Email packages are sealed
  // into the artifact: Bun cannot resolve a bare `@react-email/*` import from the
  // isolate's temp directory.
  external: ["react", "react-dom", "react/jsx-runtime"],
  format: "esm" as const,
  macros: false,
  minify: false,
  plugins: [
    {
      name: "workspace-only",
      setup(build: Bun.PluginBuilder) {
        // A path that leaves the checkout as written (absolute, or by `..`) is refused
        // before the resolver looks for it, and the error names the file that imports it.
        // This is the common case answered well, not the guard: a package.json `main`
        // below the root can still climb out, and only the load below stops that (which
        // tells such a path that exists from one that does not, and nothing more).
        build.onResolve({ filter: /^(\.|\/)/ }, (args) => {
          if (
            args.kind !== "entry-point-build" &&
            !inWorkspace(NodePath.resolve(args.resolveDir, args.path))
          ) {
            throw new Error(OUTSIDE_WORKSPACE);
          }
          return undefined;
        });
        // Every file the bundler is about to read, however it was reached: a symlink, a
        // linked dependency in node_modules, a package.json `main`. Returning nothing
        // leaves the load to the bundler.
        build.onLoad({ filter: /.*/ }, (args) => {
          // A path that cannot be resolved throws here, which refuses it too.
          if (!inWorkspace(NodeFS.realpathSync(args.path))) {
            throw new Error(OUTSIDE_WORKSPACE);
          }
          return undefined;
        });
      },
    },
  ],
  sourcemap: "none" as const,
  target: "bun" as const,
  // No tsconfig or jsconfig of the workspace's is read, at any depth, once this names a
  // file: an `extends` may name any file of the host, whose `jsxImportSource` or `paths`
  // would then show in the artifact or in an error. An empty file is an empty tsconfig.
  tsconfig: "/dev/null",
  // A failed build answers with its logs rather than rejecting with them.
  throw: false,
};

const result = await Bun.build(config);
const artifact = result.outputs.find((output) => output.kind === "entry-point");

process.stdout.write(
  `${JSON.stringify(
    result.success && artifact
      ? { artifact: Buffer.from(await artifact.arrayBuffer()).toString("base64"), ok: true }
      : {
          // Each error with where in the workspace's source it points. One that points
          // nowhere in the workspace is reported in fixed words: the bundler's message
          // about a file can quote the file.
          detail: [
            ...new Set(
              result.logs
                .filter((log) => log.level === "error")
                .map((log) => {
                  if (!(log.position && inWorkspace(log.position.file))) {
                    return OUTSIDE_WORKSPACE;
                  }
                  const file = log.position.file.slice(workspaceDir.length + 1);
                  // Our own refusal has no line: the plugin is not told where the import is.
                  return log.message === OUTSIDE_WORKSPACE
                    ? `${file}: ${log.message}`
                    : `${file}:${log.position.line}:${log.position.column}: ${log.message}\n${log.position.lineText}`;
                }),
            ),
          ].join("\n"),
          ok: false,
        },
  )}\n`,
);
