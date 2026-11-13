import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { runBunInstall } from "./bun-install";

describe("runBunInstall", () => {
  test("returns ok: false with stderr when the install fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "relayit-bun-install-"));
    try {
      await fs.writeFile(path.join(dir, "package.json"), "{ not json");

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
      await fs.rm(dir, { force: true, recursive: true });
    }
  });

  test("returns ok: false with the spawn error when cwd does not exist", async () => {
    const result = await Effect.runPromise(
      runBunInstall({
        args: ["--ignore-scripts"],
        cwd: path.join(os.tmpdir(), `relayit-missing-${Bun.randomUUIDv7()}`),
        operation: "test",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
