import { describe, expect, test } from "bun:test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { runBunInstall } from "./bun-install";

describe("runBunInstall", () => {
  test("returns ok: false with stderr when the install fails", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-bun-install-"));
    try {
      await NodeFSP.writeFile(NodePath.join(dir, "package.json"), "{ not json");

      const result = await Effect.runPromise(
        runBunInstall({
          args: ["--frozen-lockfile", "--ignore-scripts"],
          cwd: dir,
          operation: "test",
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("package.json");
    } finally {
      await NodeFSP.rm(dir, { force: true, recursive: true });
    }
  });

  test("returns ok: false with the spawn error when cwd does not exist", async () => {
    const result = await Effect.runPromise(
      runBunInstall({
        args: ["--ignore-scripts"],
        cwd: NodePath.join(NodeOS.tmpdir(), `relayit-missing-${Bun.randomUUIDv7()}`),
        operation: "test",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
