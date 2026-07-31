const WORKSPACE_PATH_RE = /^(?!\/)(?!.*\.\.(?:\/|$))[a-zA-Z0-9_./-]+$/;
const LEADING_SLASHES_RE = /^\/+/;

/** Normalize and validate a workspace-relative path (kind-agnostic). */
export function normalizeWorkspacePath(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replaceAll("\\", "/")
    .replace(LEADING_SLASHES_RE, "");
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

export function contentTypeForWorkspacePath(path: string): string {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) {
    return "text/typescript";
  }
  if (path.endsWith(".json")) {
    return "application/json";
  }
  if (path.endsWith(".lock") || path.endsWith(".lockb")) {
    return "application/octet-stream";
  }
  if (path.endsWith(".css")) {
    return "text/css";
  }
  return "text/plain";
}
