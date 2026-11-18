import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

/** The checkout these scripts run in. */
export const ROOT = NodePath.resolve(import.meta.dir, "../../..");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The root .env under the shell's environment, plus the URLs the apps reach each other by,
 * built from its ports unless set. One file serves every app, and a worktree's ports differ
 * from the main checkout's, so no URL is written down twice.
 */
export const developmentEnv = (): Record<string, string> => {
  const path = NodePath.join(ROOT, ".env");
  const file = NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
  const env = Object.fromEntries(
    Object.entries({ ...file, ...process.env }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const url = (portVariable: string, fallback: string) =>
    `http://localhost:${env[portVariable] ?? fallback}`;
  return {
    ...env,
    API_URL: env.API_URL ?? url("API_PORT", "3005"),
    APP_URL: env.APP_URL ?? url("WEB_PORT", "3000"),
    TEMPLATING_BUILDER_URL: env.TEMPLATING_BUILDER_URL ?? url("BUILDER_PORT", "3006"),
    VITE_BASE_URL: env.VITE_BASE_URL ?? url("WEB_PORT", "3000"),
  };
};

/** Stops a script that writes data before it reaches anything but this machine. */
export const requireLocal = (name: string, value: string | undefined) => {
  if (!value) {
    throw new Error(
      `${name} is not set: copy .env.example to .env, or run bun run worktree:setup.`,
    );
  }
  if (!LOCAL_HOSTS.has(new URL(value).hostname)) {
    throw new Error(`${name} is not on localhost; this script only writes to a local one.`);
  }
  return value;
};
