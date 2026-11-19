import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import { Effect } from "effect";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

/** The api as its image starts it, with only `env` in its environment. Killed with the test. */
const startApi = (env: Record<string, string>) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn(["bun", "--no-env-file", NodePath.join(import.meta.dirname, "index.ts")], {
        env: { HOME: Bun.env.HOME, PATH: Bun.env.PATH, ...env },
        stderr: "pipe",
        stdout: "pipe",
      }),
    ),
    (child) =>
      Effect.promise(async () => {
        child.kill();
        await child.exited;
      }),
  );

describe("the api's process", () => {
  it.live("given a LOG_LEVEL that does not exist, says so and exits non-zero", () =>
    Effect.gen(function* () {
      const api = yield* startApi({ LOG_LEVEL: "verbose" });

      const [code, output, errors] = yield* Effect.promise(() =>
        Promise.all([api.exited, new Response(api.stdout).text(), new Response(api.stderr).text()]),
      );
      expect(code).toBe(1);
      expect(output + errors).toContain("Process failed");
      expect(output + errors).toContain("LOG_LEVEL");
    }).pipe(Effect.scoped),
  );

  if (!testDatabaseUrl || !testRedisUrl) {
    process.emitWarning(
      "Skipping the api's startup integration test: TEST_DATABASE_URL or TEST_REDIS_URL is not set",
    );
    test.skip("given LOG_LEVEL=info, serves and logs at info", () => undefined);
    return;
  }

  it.live("given LOG_LEVEL=info, serves and logs at info", () =>
    Effect.gen(function* () {
      const port = yield* Effect.promise(
        () =>
          new Promise<number>((resolve, reject) => {
            const server = NodeNet.createServer().once("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              server.close(() =>
                typeof address === "object" && address !== null
                  ? resolve(address.port)
                  : reject(new Error("no port")),
              );
            });
          }),
      );
      const api = yield* startApi({
        API_URL: `http://127.0.0.1:${port}`,
        APP_URL: "http://app.test",
        BETTER_AUTH_SECRETS: "1:startup-test-secret-0123456789abcdef",
        DATABASE_URL: testDatabaseUrl,
        EMAIL_BACKEND: "fake",
        HOST: "127.0.0.1",
        LOG_LEVEL: "info",
        NODE_ENV: "test",
        OBJECT_STORAGE: "local",
        PORT: String(port),
        REDIS_KEY_PREFIX: `test:${Bun.randomUUIDv7()}:`,
        REDIS_URL: testRedisUrl,
      });

      // Its own info line, which a level above info would have dropped, is the last thing
      // it does before serving.
      const output = yield* Effect.promise(async () => {
        let read = "";
        const decoder = new TextDecoder();
        for await (const chunk of api.stdout) {
          read += decoder.decode(chunk, { stream: true });
          if (read.includes("Relayit API listening")) {
            break;
          }
        }
        return read;
      });
      expect(output).toContain("Relayit API listening");

      const health = yield* Effect.promise(() => fetch(`http://127.0.0.1:${port}/health`));
      expect(health.status).toBe(200);
    }).pipe(Effect.scoped),
  );
});
