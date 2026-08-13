import type { WorkspaceEntryPropsShape } from "@repo/persistence/db/schema";

const PROPS_BLOCK_RE =
  /(?:export\s+)?(?:type|interface)\s+Props\s*(?:=\s*)?\{([^}]*)\}/m;
const PROP_LINE_SPLIT_RE = /[;\n]/;
const PROP_NAME_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\?)?\s*:/;

/**
 * Best-effort props inference from a React Email entry source file.
 * Looks for `export type Props = { … }` / `interface Props { … }` property names.
 */
export function inferReactEmailPropsFromSource(
  source: string
): WorkspaceEntryPropsShape {
  const blockMatch = PROPS_BLOCK_RE.exec(source);

  if (!blockMatch?.[1]) {
    return {};
  }

  const properties: Record<string, { required: boolean; type: "unknown" }> = {};

  for (const line of blockMatch[1].split(PROP_LINE_SPLIT_RE)) {
    const propMatch = PROP_NAME_RE.exec(line);
    if (!propMatch?.[1]) {
      continue;
    }
    properties[propMatch[1]] = {
      required: propMatch[2] !== "?",
      type: "unknown",
    };
  }

  return { properties };
}
