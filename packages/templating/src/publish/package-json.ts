import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";

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
export const assertHardenedPackageJson = (
  raw: string
): Effect.Effect<PackageJson, TemplatingBuilderError> => {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return Effect.fail(
      new TemplatingBuilderError({
        code: "invalid",
        message: "package.json is not valid JSON.",
      })
    );
  }

  const forbidden = collectDeps(pkg).filter(([, spec]) =>
    isForbiddenSpec(spec)
  );

  if (forbidden.length > 0) {
    return Effect.fail(
      new TemplatingBuilderError({
        code: "invalid",
        message:
          "package.json has disallowed dependency specs (registry versions only).",
      })
    );
  }

  return Effect.succeed(pkg);
};
