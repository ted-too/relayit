/**
 * Runs a command with the root .env (see root-env.ts); `--app <name>` also gives it that
 * app's port as PORT. The app scripts' `dev` and the Drizzle scripts go through it.
 *
 *   bun tooling/scripts/src/with-env.ts --app api bun --no-env-file run --watch ./src/index.ts
 */
import { developmentEnv } from "./root-env";

const PORT_VARIABLES = {
  api: "API_PORT",
  builder: "BUILDER_PORT",
  site: "SITE_PORT",
  web: "WEB_PORT",
} as const;

const args = process.argv.slice(2);
const app = args[0] === "--app" ? args[1] : undefined;
const command = app === undefined ? args : args.slice(2);
if (app !== undefined && !(app in PORT_VARIABLES)) {
  throw new Error(`--app must be one of ${Object.keys(PORT_VARIABLES).join(", ")}`);
}
if (command.length === 0) {
  throw new Error("with-env.ts needs a command to run");
}

const env = developmentEnv();
env.NODE_ENV ??= "development";
if (app !== undefined) {
  const port = env[PORT_VARIABLES[app as keyof typeof PORT_VARIABLES]];
  if (port) {
    env.PORT = port;
  }
}

const child = Bun.spawn(command, { env, stdio: ["inherit", "inherit", "inherit"] });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
process.exit(await child.exited);
