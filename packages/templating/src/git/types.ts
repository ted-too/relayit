export type GitObjectType = "blob" | "tree" | "commit";

/** Path → blob object id. */
export interface GitTree {
  files: Record<string, string>;
}

export interface GitCommit {
  author: string;
  message: string;
  parent: string | null;
  timestamp: string;
  tree: string;
}

export const HOSTED_DEV_REF = "dev";
export const HOSTED_MAIN_REF = "main";
