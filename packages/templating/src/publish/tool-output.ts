import * as NodeFS from "node:fs";

// Enough for a bundler's messages or an install's errors, and small beside an Rpc answer.
const MAX_LENGTH = 4000;

// Tools report the real path, which on macOS is not the one `os.tmpdir()` gave.
const spellings = (dir: string) => new Set([NodeFS.realpathSync(dir), dir]);

/** Whether a path a tool reported lies inside `dir`, by either spelling of `dir`. */
export const isInDirectory = (path: string, dir: string) =>
  [...spellings(dir)].some((spelling) => path.startsWith(`${spelling}/`));

/**
 * What `bun install` or the bundler said about a workspace, as its owner may read it: the
 * source it quotes is theirs, but the checkout's temp directory is the host's, so paths
 * are cut down to workspace-relative ones.
 */
export const workspaceToolOutput = (output: string, workspaceDir: string) => {
  let text = output;
  for (const dir of spellings(workspaceDir)) {
    text = text.replaceAll(`${dir}/`, "").replaceAll(dir, ".");
  }
  text = text.trim();
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
};
