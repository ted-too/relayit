/**
 * `bun run test`: every workspace package's tests, integration tests included, against a
 * throwaway Postgres and Redis this run starts in Docker and removes, so a test only ever
 * touches data the run created. Every package runs even after one fails; the run exits
 * non-zero if any did. Set both TEST_DATABASE_URL and TEST_REDIS_URL to use your own.
 */
import * as NodePath from "node:path";
import { migrateOnStartup } from "@repo/persistence/db/migrate";
import { ROOT } from "./root-env";

const RUN_LABEL = "relayit.test-run";
const CONCURRENCY = 4;

const docker = async (args: string[]) => {
  const child = Bun.spawn(["docker", ...args], { stderr: "pipe", stdout: "pipe" });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`docker ${args[0]} failed: ${error.trim()}`);
  }
  return output.trim();
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const retry = async (what: string, attempt: () => Promise<unknown>) => {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= 60) {
        throw new Error(`${what} did not come up`, { cause: error });
      }
      await Bun.sleep(500);
    }
  }
};

const containers: string[] = [];
const removeContainers = () =>
  containers.length > 0 ? docker(["rm", "-f", ...containers.splice(0)]).catch(() => "") : "";
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await removeContainers();
    process.exit(130);
  });
}

/** One Postgres and one Redis for the whole run, each on a free port of 127.0.0.1. */
const startServices = async () => {
  // Containers of an earlier run that was killed before it could remove them.
  for (const line of (
    await docker([
      "ps",
      "-a",
      "--filter",
      `label=${RUN_LABEL}`,
      "--format",
      `{{.ID}} {{.Label "${RUN_LABEL}"}}`,
    ])
  ).split("\n")) {
    const [id, pid] = line.split(" ");
    if (id && pid && !isAlive(Number(pid))) {
      await docker(["rm", "-f", id]);
    }
  }
  const run = (image: string, args: string[]) =>
    docker(["run", "-d", "--rm", "--label", `${RUN_LABEL}=${process.pid}`, ...args, image]).then(
      (id) => {
        containers.push(id);
        return id;
      },
    );
  const [postgres, redis] = await Promise.all([
    run("postgres:18-alpine", [
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=relayit_test",
      "--tmpfs",
      "/var/lib/postgresql",
    ]),
    run("redis:7-alpine", ["-p", "127.0.0.1::6379"]),
  ]);
  const databaseUrl = `postgres://postgres:postgres@${await docker(["port", postgres, "5432/tcp"])}/relayit_test`;
  const redisUrl = `redis://${await docker(["port", redis, "6379/tcp"])}`;
  await retry("Postgres", async () => {
    const sql = new Bun.SQL(databaseUrl);
    try {
      await sql`select 1`;
    } finally {
      await sql.close();
    }
  });
  await retry("Redis", async () => {
    const client = new Bun.RedisClient(redisUrl, { autoReconnect: false });
    try {
      await client.ping();
    } finally {
      client.close();
    }
  });
  return { databaseUrl, redisUrl };
};

const packagesWithTests = async () => {
  const found: string[] = [];
  for await (const path of new Bun.Glob("{apps,packages,tooling}/*/package.json").scan(ROOT)) {
    const manifest = (await Bun.file(NodePath.join(ROOT, path)).json()) as {
      readonly scripts?: Record<string, string>;
    };
    if (manifest.scripts?.test) {
      found.push(NodePath.dirname(path));
    }
  }
  return found.toSorted();
};

let exitCode = 0;
try {
  const services =
    process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL
      ? { databaseUrl: process.env.TEST_DATABASE_URL, redisUrl: process.env.TEST_REDIS_URL }
      : await startServices();
  await migrateOnStartup(services.databaseUrl);

  const env = {
    ...process.env,
    TEST_DATABASE_URL: services.databaseUrl,
    TEST_REDIS_URL: services.redisUrl,
  };

  const queue = await packagesWithTests();
  const results: { readonly ok: boolean; readonly path: string; readonly seconds: string }[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const started = performance.now();
        const child = Bun.spawn(["bun", "run", "test"], {
          cwd: NodePath.join(ROOT, path),
          env,
          stderr: "pipe",
          stdout: "pipe",
        });
        const [output, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        console.log(
          `\n── ${path} ${code === 0 ? "passed" : "FAILED"} (${seconds}s)\n${output}${error}`,
        );
        results.push({ ok: code === 0, path, seconds });
      }
    }),
  );

  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length} of ${results.length} packages passed.` +
      (failed.length > 0 ? `\nFailed: ${failed.map((result) => result.path).join(", ")}` : ""),
  );
  exitCode = failed.length > 0 ? 1 : 0;
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await removeContainers();
}
process.exit(exitCode);
