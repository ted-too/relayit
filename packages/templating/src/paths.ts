const WORKSPACE_PATH_RE = /^(?!\/)(?!.*\.\.(?:\/|$))[a-zA-Z0-9_./-]+$/;
const LEADING_SLASHES_RE = /^\/+/;

/**
 * Whether a workspace path is one of the files Bun takes its own configuration from: the
 * registry an install asks, and what the bundler preloads and defines. A workspace
 * installs from the public registry and builds with the builder's settings, so it may
 * hold neither, at any depth.
 */
export function isBunConfigPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return name === ".npmrc" || name === "bunfig.toml";
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
