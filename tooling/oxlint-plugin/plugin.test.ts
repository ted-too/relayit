import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, expect, it } from "vite-plus/test";

// The oxlint `vp check` runs: the one vite-plus depends on, not this package's own copy.
const oxlintPackageJson = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("vite-plus/package.json"),
).resolve("oxlint/package.json");

// Each rule breaks once. The rule tests check what each rule reports; this checks that
// the real binary loads the plugin from a config and runs every rule in `rules/`, which
// fails if `index.ts` leaves one out.
const fixture = `
import { readFile } from "node:fs/promises";
import { it } from "@effect/vitest";
import { Schema } from "effect";
import * as Effect from "effect/Effect";

const User = Schema.Struct({ name: Schema.String });
export const parseUser = (input: unknown) => Schema.decodeUnknownEffect(User)(input);
export const recover = Effect.catchTag("A", () => Effect.void);

Effect.runSync(Effect.void);
for (const value of [1, 2]) it(String(value), () => {});

// @ts-expect-error
export const count: number = readFile;

export const notFound = (id: string) => new DeliveryError({ id, message: \`\${id} not found\` });
export const job = defineJob({ name: "verify", payload: Schema.Struct({}) });
export const worker = runJobWorker(handlers, options) as never;
export type Db = Effect.Success<typeof DB>;
`;

const tempDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

it("runs every rule through the oxlint binary", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "relayit-oxlint-"));
  tempDirs.push(dir);
  const configPath = NodePath.join(dir, ".oxlintrc.json");
  const sourcePath = NodePath.join(dir, "fixture.test.tsx");
  const ruleNames = NodeFS.readdirSync(NodePath.join(import.meta.dirname, "rules"))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => file.slice(0, -".ts".length));
  NodeFS.writeFileSync(
    configPath,
    JSON.stringify({
      jsPlugins: [{ name: "relayit", specifier: NodePath.join(import.meta.dirname, "index.ts") }],
      rules: Object.fromEntries(ruleNames.map((name) => [`relayit/${name}`, "error"])),
    }),
  );
  NodeFS.writeFileSync(sourcePath, fixture);

  // Through the current Node binary: oxlint's bin is an extensionless shebang script.
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [
      NodePath.join(NodePath.dirname(oxlintPackageJson), "bin", "oxlint"),
      "--config",
      configPath,
      "--format",
      "json",
      sourcePath,
    ],
    { encoding: "utf8" },
  );
  const report: { diagnostics: Array<{ code: string }> } = JSON.parse(result.stdout);

  expect(
    new Set(
      report.diagnostics.map(({ code }) => code).filter((code) => code.startsWith("relayit(")),
    ),
  ).toEqual(new Set(ruleNames.map((name) => `relayit(${name})`)));
});
