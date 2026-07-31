import { createGenericError, type Result } from "@repo/api/utils";

const FORBIDDEN_DEP_PREFIXES = [
  "git+",
  "github:",
  "http:",
  "https:",
  "file:",
  "link:",
  "workspace:",
] as const;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function collectDeps(pkg: PackageJson): [string, string][] {
  return Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  });
}

function isForbiddenSpec(spec: string): boolean {
  const lower = spec.trim().toLowerCase();
  return FORBIDDEN_DEP_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Reject non-registry dependency specs before Bun install. */
export function assertHardenedPackageJson(raw: string): Result<PackageJson> {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return {
      error: createGenericError("package.json is not valid JSON"),
      data: null,
    };
  }

  const forbidden = collectDeps(pkg).filter(([, spec]) =>
    isForbiddenSpec(spec)
  );

  if (forbidden.length > 0) {
    return {
      error: createGenericError(
        "package.json has disallowed dependency specs (registry versions only)",
        forbidden.map(([name, spec]) => `${name}: ${spec}`)
      ),
      data: null,
    };
  }

  return { error: null, data: pkg };
}
