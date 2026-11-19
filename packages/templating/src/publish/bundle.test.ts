/** The real bundler over a workspace laid out on disk, for what no commit can put in one. */
import { describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { bundleReactEmailEntry } from "./bundle";

const tempDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix))),
    (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
  );

/** A workspace whose one Entry renders what `source` imports as `value`, and a host directory. */
const workspaceImporting = (source: string) =>
  Effect.gen(function* () {
    const workspaceDir = yield* tempDirectory("relayit-bundle-");
    const outside = yield* tempDirectory("relayit-host-file-");
    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(NodePath.join(workspaceDir, "reactEmail"));
      await NodeFSP.writeFile(
        NodePath.join(workspaceDir, "reactEmail", "entry.tsx"),
        `${source}\nexport default function Email() {\n  return String(value);\n}\n`,
      );
      await NodeFSP.writeFile(NodePath.join(outside, "environ"), "DATABASE_URL=from-the-host\n");
      await NodeFSP.writeFile(
        NodePath.join(outside, "index.js"),
        'export default "DATABASE_URL=from-the-host";\n',
      );
    });
    return { outside, workspaceDir };
  });

const refusedAsOutside = (workspaceDir: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      bundleReactEmailEntry({ entryPath: "reactEmail/entry.tsx", workspaceDir }),
    );
    expect(failure.detail).toBe("An import reaches outside the workspace.");
  });

describe("bundleReactEmailEntry", () => {
  it.live("bundles what an Entry imports from its own workspace", () =>
    Effect.gen(function* () {
      const { workspaceDir } = yield* workspaceImporting('import value from "../lib/own.txt";');
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(workspaceDir, "lib"));
        await NodeFSP.writeFile(NodePath.join(workspaceDir, "lib", "own.txt"), "the workspace's");
      });

      const artifact = yield* bundleReactEmailEntry({
        entryPath: "reactEmail/entry.tsx",
        workspaceDir,
      });

      expect(new TextDecoder().decode(artifact)).toContain("the workspace's");
    }),
  );

  it.live("refuses a symlink in the workspace that points at a host file", () =>
    Effect.gen(function* () {
      const { outside, workspaceDir } = yield* workspaceImporting(
        'import value from "./linked.txt" with { type: "text" };',
      );
      yield* Effect.promise(() =>
        NodeFSP.symlink(
          NodePath.join(outside, "environ"),
          NodePath.join(workspaceDir, "reactEmail", "linked.txt"),
        ),
      );

      yield* refusedAsOutside(workspaceDir);
    }),
  );

  // What a `link:` dependency leaves in node_modules.
  it.live("refuses a package in node_modules that is a link to a host directory", () =>
    Effect.gen(function* () {
      const { outside, workspaceDir } = yield* workspaceImporting('import value from "linked";');
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(workspaceDir, "node_modules"));
        await NodeFSP.symlink(outside, NodePath.join(workspaceDir, "node_modules", "linked"));
      });

      yield* refusedAsOutside(workspaceDir);
    }),
  );

  it.live("builds without the workspace's tsconfig, which may extend a file of the host's", () =>
    Effect.gen(function* () {
      const { outside, workspaceDir } = yield* workspaceImporting("const value = <p>hello</p>;");
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(
          NodePath.join(outside, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { jsxImportSource: "from-the-host" } }),
        );
        // At both depths the bundler looks for one.
        for (const dir of [workspaceDir, NodePath.join(workspaceDir, "reactEmail")]) {
          await NodeFSP.writeFile(
            NodePath.join(dir, "tsconfig.json"),
            JSON.stringify({ extends: NodePath.join(outside, "tsconfig.json") }),
          );
        }
      });

      const artifact = yield* bundleReactEmailEntry({
        entryPath: "reactEmail/entry.tsx",
        workspaceDir,
      });

      const code = new TextDecoder().decode(artifact);
      expect(code).toContain('from "react/jsx');
      expect(code).not.toContain("from-the-host");
    }),
  );
});
