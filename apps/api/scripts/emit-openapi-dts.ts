import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dtsRoot = join(root, ".openapi-dts");
const emitted = join(dtsRoot, "apps/api/src/index.d.ts");
const output = join(root, "build/index.d.ts");

rmSync(dtsRoot, { force: true, recursive: true });
mkdirSync(join(root, "build"), { recursive: true });

const tscBin = Bun.which("tsc");
if (!tscBin) {
  throw new Error("tsc not found; cannot emit OpenAPI declarations");
}

const tsc = Bun.spawnSync([tscBin, "-p", "tsconfig.dts.json"], {
  cwd: root,
  stderr: "pipe",
  stdout: "pipe",
});

if (!existsSync(emitted)) {
  process.stdout.write(tsc.stdout);
  process.stderr.write(tsc.stderr);
  rmSync(dtsRoot, { force: true, recursive: true });
  throw new Error("Failed to emit OpenAPI declaration file");
}

copyFileSync(emitted, output);
rmSync(dtsRoot, { force: true, recursive: true });
