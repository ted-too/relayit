const WORKSPACE_PATH_RE = /^(?!\/)(?!.*\.\.(?:\/|$))[a-zA-Z0-9_./-]+$/;
const LEADING_SLASHES_RE = /^\/+/;

// Another package manager's lockfile is one too: with no `bun.lock` beside it Bun installs
// from it, paths and URLs included.
const BUN_CONFIG_NAMES = new Set([
  ".npmrc",
  "bunfig.toml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/**
 * Whether a workspace path is one of the files Bun takes its own configuration from: the
 * registry an install asks, where a dependency comes from, and what the bundler preloads
 * and defines. A workspace installs from the public registry and builds with the
 * builder's settings, so it may hold none, at any depth.
 */
export function isBunConfigPath(path: string): boolean {
  return BUN_CONFIG_NAMES.has(path.slice(path.lastIndexOf("/") + 1).toLowerCase());
}

/** Normalize and validate a workspace-relative path (kind-agnostic). */
export function normalizeWorkspacePath(raw: string): string | null {
  const trimmed = raw.trim().replaceAll("\\", "/").replace(LEADING_SLASHES_RE, "");
  if (!trimmed || trimmed.length > 512) {
    return null;
  }
  if (!WORKSPACE_PATH_RE.test(trimmed)) {
    return null;
  }
  if (trimmed.includes("//") || trimmed.endsWith("/")) {
    return null;
  }
  return trimmed;
}
