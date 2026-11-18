/**
 * API key auth on the public routes through real better-auth and Postgres: keys made the
 * way the dashboard makes them, verified the way a send verifies them. Only accept is
 * stubbed, so each send records the Project its key resolved to.
 */
import { describe, expect, layer, test } from "@effect/vitest";
import type { AcceptTransactionalEmailInput } from "@repo/channels/email/accept";
import { createPromiseDb } from "@repo/persistence/db/promise";
import { apikey } from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { apiConfig } from "./env";
import { apiServer } from "./http";
import { makeApiServices } from "./layers";
import { ApiAuth } from "./lib/auth";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;
const APP = "http://app.test";

describe("API key auth (PostgreSQL, Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning("Skipping API key tests: TEST_DATABASE_URL or TEST_REDIS_URL unset");
    // The PostgreSQL and Redis test is opt-in.
    test.skip("API key auth", () => undefined);
    return;
  }

  class Origin extends Context.Service<Origin, string>()("test/Origin") {}

  const run = Bun.randomUUIDv7();
  const accepted: AcceptTransactionalEmailInput[] = [];
  const server = Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* apiConfig;
      return Layer.effect(
        Origin,
        Effect.gen(function* () {
          const { address } = yield* HttpServer.HttpServer;
          if (address._tag === "UnixPathAddress") {
            return yield* Effect.die("the api listens on TCP");
          }
          return `http://127.0.0.1:${address.port}`;
        }),
      ).pipe(
        Layer.provideMerge(
          apiServer({
            accept: (input) => {
              accepted.push(input);
              return Effect.succeed({
                deliveryId: "edlv_1",
                messageId: "msg_1",
                replayed: false,
                stripped: [],
              });
            },
            appOrigin: APP,
            dashboard: { billing: false, githubSignIn: false },
            hostname: "127.0.0.1",
            port: 0,
            unsubscribeSecret: "test-secret",
          }),
        ),
        Layer.provideMerge(ApiAuth.layer({ ...config, rateLimit: false })),
        Layer.provideMerge(makeApiServices(config)),
      );
    }),
  ).pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            API_URL: "http://api.test",
            APP_URL: APP,
            BETTER_AUTH_SECRETS: "1:api-key-test-secret-0123456789abcdef",
            DATABASE_URL: testDatabaseUrl,
            EMAIL_BACKEND: "fake",
            LOG_LEVEL: "Error",
            NODE_ENV: "test",
            OBJECT_STORAGE: "local",
            REDIS_KEY_PREFIX: `test:${run}:`,
            REDIS_URL: testRedisUrl,
          },
        }),
      ),
    ),
  );

  /** One request, read whole. `as` is a session cookie, `key` an API key. */
  const call = (
    method: string,
    path: string,
    options: { readonly as?: string; readonly body?: unknown; readonly key?: string } = {},
  ) =>
    Effect.gen(function* () {
      const origin = yield* Origin;
      return yield* Effect.promise(async () => {
        const response = await fetch(`${origin}${path}`, {
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          headers: {
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            ...(options.as === undefined ? {} : { cookie: options.as, origin: APP }),
            ...(options.key === undefined ? {} : { "x-api-key": options.key }),
          },
          method,
        });
        const text = await response.text();
        return {
          body: text === "" ? undefined : (JSON.parse(text) as unknown),
          cookies: response.headers.getSetCookie(),
          status: response.status,
        };
      });
    });

  /** A new owner with a Project and one of its API keys, made through the dashboard. */
  const projectWithKey = (name: string) =>
    Effect.gen(function* () {
      const signedUp = yield* call("POST", "/auth/sign-up/email", {
        body: { email: `${name}-${run}@example.test`, name, password: "a-long-password" },
      });
      expect(signedUp.status).toBe(200);
      const as = signedUp.cookies.map((cookie) => cookie.split(";")[0]).join("; ");
      const project = yield* call("POST", "/projects", { as, body: { name } });
      expect(project.status).toBe(200);
      const { id, slug } = project.body as { readonly id: string; readonly slug: string };
      const newKey = () =>
        Effect.gen(function* () {
          const created = yield* call("POST", `/projects/${slug}/api-keys`, {
            as,
            body: { name: "Server" },
          });
          expect(created.status).toBe(200);
          return created.body as { readonly apiKey: { readonly id: string }; readonly key: string };
        });
      return { id, key: (yield* newKey()).key, newKey, slug };
    });

  const send = { from: "hello@example.test", subject: "Hi", text: "Hi", to: "jane@example.test" };
  const legacy = {
    from: "hello@example.test",
    payload: { subject: "Hi", text: "Hi" },
    to: "jane@example.test",
  };

  layer(server, { timeout: "60 seconds" })((it) => {
    it.effect("accepts a Project's key as that Project, on both send paths", () =>
      Effect.gen(function* () {
        const a = yield* projectWithKey("alpha");
        accepted.length = 0;

        expect(yield* call("POST", "/messages/email", { body: send, key: a.key })).toMatchObject({
          body: { id: "msg_1" },
          status: 201,
        });
        expect(
          yield* call("POST", `/send/${a.slug}/raw/email`, { body: legacy, key: a.key }),
        ).toMatchObject({ body: { id: "msg_1", status: "queued" }, status: 201 });
        expect(accepted.map((input) => input.organizationId)).toEqual([a.id, a.id]);
      }),
    );

    it.effect("refuses an unknown, disabled or expired key", () =>
      Effect.gen(function* () {
        const a = yield* projectWithKey("bravo");
        const disabled = yield* a.newKey();
        const expired = yield* a.newKey();
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        yield* Effect.promise(async () => {
          await db.update(apikey).set({ enabled: false }).where(eq(apikey.id, disabled.apiKey.id));
          await db
            .update(apikey)
            .set({ expiresAt: new Date(Date.now() - 60_000) })
            .where(eq(apikey.id, expired.apiKey.id));
          await db.$client.end();
        });
        accepted.length = 0;

        for (const key of [
          "rel_org_unknown0000000000000000000000000000000000000000000000000000",
          disabled.key,
          expired.key,
        ]) {
          expect(yield* call("POST", "/messages/email", { body: send, key })).toMatchObject({
            body: { code: "invalid_api_key", message: "Invalid API key" },
            status: 403,
          });
          expect(
            (yield* call("POST", `/send/${a.slug}/raw/email`, { body: legacy, key })).status,
          ).toBe(401);
        }
        expect(accepted).toEqual([]);
      }),
    );

    it.effect("refuses one Project's key on another Project's legacy path", () =>
      Effect.gen(function* () {
        const a = yield* projectWithKey("charlie");
        const b = yield* projectWithKey("delta");
        accepted.length = 0;

        expect(
          yield* call("POST", `/send/${b.slug}/raw/email`, { body: legacy, key: a.key }),
        ).toMatchObject({ body: { message: "Project not found" }, status: 404 });
        expect(
          yield* call("POST", `/send/${b.slug}/template/email`, {
            body: { ...legacy, payload: undefined, template: { slug: "welcome" } },
            key: a.key,
          }),
        ).toMatchObject({ status: 404 });
        expect(accepted).toEqual([]);

        // Its own path still takes it, as its own Project.
        expect(
          (yield* call("POST", `/send/${a.slug}/raw/email`, { body: legacy, key: a.key })).status,
        ).toBe(201);
        expect(accepted.map((input) => input.organizationId)).toEqual([a.id]);
      }),
    );
  });
});
