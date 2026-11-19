/**
 * `POST /messages/email` with attachments through the real accept, better-auth, Postgres,
 * Redis and local object storage, with the fake email backend: what a customer sends is
 * decoded, counted and staged as it would be in production.
 */
import { describe, expect, layer, test } from "@effect/vitest";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@repo/channels/email/attachment-policy";
import { createPromiseDb } from "@repo/persistence/db/promise";
import { customDomain, organizationDomain } from "@repo/persistence/db/schema";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { typeid } from "typeid-js";
import { apiConfig } from "../../env";
import { apiServer } from "../../http";
import { makeApiServices } from "../../layers";
import { ApiAuth } from "../../lib/auth";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;
const APP = "http://app.test";

describe("POST /messages/email with attachments (PostgreSQL, Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping attachment send tests: TEST_DATABASE_URL or TEST_REDIS_URL unset",
    );
    // The PostgreSQL and Redis test is opt-in.
    test.skip("attachment sends", () => undefined);
    return;
  }

  class Origin extends Context.Service<Origin, string>()("test/Origin") {}

  const run = Bun.randomUUIDv7();
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
            appOrigin: APP,
            dashboard: { billing: false, emailWorkspaceEditing: true, githubSignIn: false },
            hostname: "127.0.0.1",
            port: 0,
            unsubscribeSecrets: ["test-secret"],
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
            BETTER_AUTH_SECRETS: "1:attachment-test-secret-0123456789abcdef",
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

  /** A Project with an API key and a verified Domain to send from. */
  const sendingProject = Effect.gen(function* () {
    const signedUp = yield* call("POST", "/auth/sign-up/email", {
      body: { email: `sender-${run}@example.test`, name: "Sender", password: "a-long-password" },
    });
    expect(signedUp.status).toBe(200);
    const as = signedUp.cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    const project = yield* call("POST", "/projects", { as, body: { name: "Attachments" } });
    expect(project.status).toBe(200);
    const { id, slug } = project.body as { readonly id: string; readonly slug: string };
    const created = yield* call("POST", `/projects/${slug}/api-keys`, {
      as,
      body: { name: "Server" },
    });
    expect(created.status).toBe(200);
    const fqdn = `${run}.attachments.example.test`;
    yield* Effect.promise(async () => {
      const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
      const domainId = typeid("domn").toString();
      await db.insert(customDomain).values({
        dkimPrivateKey: "private",
        dkimPublicKey: "public",
        dkimSelector: "relayit",
        fqdn,
        id: domainId,
        verificationStatus: "verified",
      });
      await db.insert(organizationDomain).values({
        customDomainId: domainId,
        organizationId: id,
        ownershipToken: `tok_${run}`,
        ownershipVerificationStatus: "verified",
      });
      await db.$client.end();
    });
    return { from: `hello@${fqdn}`, key: (created.body as { readonly key: string }).key };
  });

  /** `bytes` of varied content, as base64. */
  const base64Of = (bytes: number) =>
    Buffer.from(new Uint8Array(bytes).map((_, index) => (index * 31 + 7) & 255)).toString("base64");

  layer(server, { timeout: "120 seconds" })((it) => {
    it.effect("stages a valid inline attachment just under the size limit", () =>
      Effect.gen(function* () {
        const { from, key } = yield* sendingProject;
        const send = (attachments: readonly unknown[]) =>
          call("POST", "/messages/email", {
            body: {
              attachments,
              from,
              subject: "Report",
              text: "Attached.",
              to: "jane@example.test",
            },
            key,
          });

        const accepted = yield* send([
          { content: base64Of(MAX_ATTACHMENT_BYTES - 1), filename: "report.pdf" },
        ]);
        expect(accepted.status).toBe(201);
        const messageId = (accepted.body as { readonly id: string }).id;
        const staged = yield* Effect.promise(async () => {
          const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
          const result = await db.$client.query<{ filename: string; size: string }>(
            `select a.filename, a.size from email_attachment a
             join email_delivery d on d.id = a.email_delivery_id
             where d.message_id = $1`,
            [messageId],
          );
          await db.$client.end();
          return result.rows.map((row) => ({ filename: row.filename, size: Number(row.size) }));
        });
        expect(staged).toEqual([{ filename: "report.pdf", size: MAX_ATTACHMENT_BYTES - 1 }]);

        // Three of nearly 10 MiB pass what SES can carry together.
        const nearly = base64Of(MAX_ATTACHMENT_BYTES - 1);
        expect(
          yield* send(
            ["1", "2", "3"].map((name) => ({ content: nearly, filename: `${name}.pdf` })),
          ),
        ).toMatchObject({
          body: {
            code: "invalid_attachment",
            details: { max_bytes: MAX_TOTAL_ATTACHMENT_BYTES, reason: "exceeds_total_size_limit" },
          },
          status: 422,
        });
      }),
    );
  });
});
