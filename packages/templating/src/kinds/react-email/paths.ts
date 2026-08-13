/** `reactEmail/<slug>.tsx` → entry slug. */
const REACT_EMAIL_ENTRY_PATH_RE =
  /^reactEmail\/([a-z0-9]+(?:-[a-z0-9]+)*)\.tsx$/;

export const REACT_EMAIL_ENTRY_ROOT = "reactEmail";

export function reactEmailEntrySlugFromPath(path: string): string | null {
  const match = REACT_EMAIL_ENTRY_PATH_RE.exec(path);
  return match?.[1] ?? null;
}

export function isReactEmailEntryPath(path: string): boolean {
  return reactEmailEntrySlugFromPath(path) !== null;
}
