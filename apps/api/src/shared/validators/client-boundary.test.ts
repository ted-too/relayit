import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sharedRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const CLIENT_ENTRYPOINTS = [
  "validators/index.ts",
  "validators/shared.ts",
  "validators/routes/admin/providers.ts",
  "validators/routes/auth.ts",
  "validators/routes/projects/project.ts",
  "validators/routes/projects/api-keys.ts",
  "providers/client.ts",
  "providers/aws/credentials.ts",
] as const;

function resolveImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@repo/api/")) {
    const rest = spec.slice("@repo/api/".length);
    const base = path.join(sharedRoot, rest);
    for (const cand of [`${base}.ts`, path.join(base, "index.ts"), base]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return cand;
      }
    }
  }
  if (spec.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const cand of [
      `${base}.ts`,
      path.join(base, "index.ts"),
      `${base}.tsx`,
      base,
    ]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return cand;
      }
    }
  }
  return null;
}

const importRe =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"`]+from\s+)?["']([^"']+)["']/g;
const importTypeRe = /\bimport\s+type\b/;
const exportTypeRe = /\bexport\s+type\b/;

function collectEnvHits(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [path.join(sharedRoot, entry)];
  const hits: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || seen.has(file)) {
      continue;
    }
    seen.add(file);

    let src: string;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const match of src.matchAll(importRe)) {
      const full = match[0];
      const isType = importTypeRe.test(full) || exportTypeRe.test(full);
      if (isType) {
        continue;
      }

      const resolved = resolveImport(file, match[1] ?? "");
      if (!resolved) {
        continue;
      }
      if (resolved.endsWith(`${path.sep}env.ts`)) {
        hits.push(path.relative(sharedRoot, file));
      }
      queue.push(resolved);
    }
  }

  return hits;
}

describe("client-safe shared modules", () => {
  it.each(CLIENT_ENTRYPOINTS)(
    "%s does not import shared/env (Bun) at runtime",
    (entry) => {
      expect(collectEnvHits(entry)).toEqual([]);
    }
  );
});
