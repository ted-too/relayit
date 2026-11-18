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

      expect(result.ok).toBe(false);
      expect(result.stderr.length).toBeGreaterThan(0);
    }),
  );
});
