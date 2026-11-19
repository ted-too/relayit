import { describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { runBunInstall } from "./bun-install";

describe("runBunInstall", () => {
  it.live("returns ok: false with stderr when the install fails", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() =>
          NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-bun-install-")),
        ),
        (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(dir, "package.json"), "{ not json"),
      );

      const result = yield* runBunInstall({
        args: ["--frozen-lockfile", "--ignore-scripts"],
        cwd: dir,
        operation: "test",
      });

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("package.json");
    }),
  );

  it.live("returns ok: false with the spawn error when cwd does not exist", () =>
    Effect.gen(function* () {
      const result = yield* runBunInstall({
        args: ["--ignore-scripts"],
        cwd: NodePath.join(NodeOS.tmpdir(), `relayit-missing-${Bun.randomUUIDv7()}`),
        operation: "test",
      });

      // No exit code: the caller can tell a host that could not run the install from a
      // workspace whose install failed.
      expect(result).toMatchObject({ exitCode: null, ok: false });
      expect(result.stderr.length).toBeGreaterThan(0);
    }),
  );

  it.live("keeps the builder's environment out of an .npmrc, so out of the install's stderr", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() =>
          NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-bun-install-")),
        ),
        (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
      );
      // A registry that has no package: Bun prints the URL it asked for, with whatever the
      // `.npmrc` expanded into it.
      const requested: string[] = [];
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            fetch: (request) => {
              requested.push(request.url);
              return new Response("not found", { status: 404 });
            },
            hostname: "127.0.0.1",
            port: 0,
          }),
        ),
        (served) => Effect.promise(() => served.stop(true)),
      );
      yield* Effect.promise(() =>
        Promise.all([
          NodeFSP.writeFile(
            NodePath.join(dir, "package.json"),
            JSON.stringify({ dependencies: { "relayit-no-such-package": "1.0.0" } }),
          ),
          NodeFSP.writeFile(
            NodePath.join(dir, ".npmrc"),
            `registry=http://127.0.0.1:${registry.port}/\${RELAYIT_TEST_BUILDER_SECRET}/\n`,
          ),
        ]),
      );
      process.env.RELAYIT_TEST_BUILDER_SECRET = "from-the-builder";
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          delete process.env.RELAYIT_TEST_BUILDER_SECRET;
        }),
      );

      const result = yield* runBunInstall({
        args: ["--ignore-scripts"],
        cwd: dir,
        operation: "test",
      });

      expect(result).toMatchObject({ exitCode: 1, ok: false });
      expect(result.stderr).toContain("relayit-no-such-package - 404");
      expect(result.stderr).not.toContain("from-the-builder");
      expect(requested.length).toBeGreaterThan(0);
      expect(requested.join("\n")).not.toContain("from-the-builder");
    }),
  );
});
