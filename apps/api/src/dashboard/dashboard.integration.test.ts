/**
 * The dashboard's operations over the real api server, better-auth and Postgres, with the
 * fake email backend and no template builder. The point is authorisation: every group
 * refuses a request without a session, a Project's operations refuse anyone who isn't its
 * member, a member's role decides what they may change, and a Project id taken from
 * another Project reaches nothing.
 */
import { describe, expect, layer, test } from "@effect/vitest";
import { createPromiseDb } from "@repo/persistence/db/promise";
import { templatingWorkspace, templatingWorkspaceEntry } from "@repo/persistence/db/schema";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { apiConfig } from "../env";
import { apiServer } from "../http";
import { makeApiServices } from "../layers";
import { ApiAuth } from "../lib/auth";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;
const APP = "http://app.test";

describe("dashboard operations (PostgreSQL, Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning("Skipping dashboard tests: TEST_DATABASE_URL or TEST_REDIS_URL unset");
    // The PostgreSQL and Redis test is opt-in.
    test.skip("dashboard operations", () => undefined);
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
            dashboard: { billing: false, githubSignIn: false },
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
            BETTER_AUTH_SECRETS: "1:dashboard-test-secret-0123456789abcdef",
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

  /** One request, read whole. `as` is a session cookie; changes come from the dashboard. */
  const call = (
    method: string,
    path: string,
    options: { readonly as?: string; readonly body?: unknown; readonly origin?: string } = {},
  ) =>
    Effect.gen(function* () {
      const origin = yield* Origin;
      return yield* Effect.promise(async () => {
        const response = await fetch(`${origin}${path}`, {
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          headers: {
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            ...(options.as === undefined ? {} : { cookie: options.as }),
            ...(method === "GET" ? {} : { origin: options.origin ?? APP }),
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

  /** Signs a new user up through better-auth and returns their session cookie. */
  const signUp = (name: string) =>
    Effect.gen(function* () {
      const response = yield* call("POST", "/auth/sign-up/email", {
        body: { email: `${name}-${run}@example.test`, name, password: "a-long-password" },
      });
      expect(response.status).toBe(200);
      return response.cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    });

  const createProject = (as: string, name: string) =>
    Effect.gen(function* () {
      const response = yield* call("POST", "/projects", { as, body: { name } });
      expect(response.status).toBe(200);
      return response.body as { readonly id: string; readonly slug: string };
    });

  layer(server, { timeout: "60 seconds" })((it) => {
    it.effect("refuses every operation without a session, and reports the config without one", () =>
      Effect.gen(function* () {
        expect(yield* call("GET", "/config")).toMatchObject({
          body: { billing: false, githubSignIn: false },
          status: 200,
        });
        for (const [method, path] of [
          ["POST", "/projects"],
          ["GET", "/projects/acme/api-keys"],
          ["GET", "/projects/acme/domains"],
          ["GET", "/projects/acme/templates"],
          ["GET", "/projects/acme/workspaces/reactEmail/entries"],
        ] as const) {
          const body = method === "GET" ? undefined : { name: "x" };
          expect((yield* call(method, path, { body })).status).toBe(401);
        }
      }),
    );

    it.effect("hands over a new API key even when writing its last characters fails", () =>
      Effect.gen(function* () {
        const { auth } = yield* ApiAuth;
        const owner = yield* signUp("keyholder");
        const p = `/projects/${(yield* createProject(owner, `Keys ${run.slice(-8)}`)).slug}`;
        const updateApiKey = auth.api.updateApiKey;
        const created = yield* Effect.acquireUseRelease(
          // better-auth is the boundary here: its write fails as a lost connection would.
          Effect.sync(() =>
            Object.assign(auth.api, {
              updateApiKey: () => Promise.reject(new Error("connection lost")),
            }),
          ),
          () => call("POST", `${p}/api-keys`, { as: owner, body: { name: "Flaky" } }),
          () => Effect.sync(() => Object.assign(auth.api, { updateApiKey })),
        );

        // A 500 here would leave a live key whose secret nobody was shown.
        expect(created).toMatchObject({
          body: { apiKey: { end: null, name: "Flaky" } },
          status: 200,
        });
        const { apiKey, key } = created.body as { apiKey: { id: string }; key: string };
        expect(key.startsWith("rel_org_")).toBe(true);
        expect((yield* call("GET", `${p}/api-keys`, { as: owner })).body).toMatchObject([
          { createdBy: { name: "keyholder" }, end: null, id: apiKey.id },
        ]);
      }),
    );

    it.effect("keeps each Project's data to its own members, and roles to their permissions", () =>
      Effect.gen(function* () {
        const { auth } = yield* ApiAuth;
        const alice = yield* signUp("alice");
        const bob = yield* signUp("bob");
        const carol = yield* signUp("carol");
        const projectA = yield* createProject(alice, `Alpha ${run.slice(-8)}`);
        const projectB = yield* createProject(bob, `Bravo ${run.slice(-8)}`);
        const a = `/projects/${projectA.slug}`;
        const b = `/projects/${projectB.slug}`;

        // Bob's Project has a Domain, a Template, an API key and a published Entry.
        const bobsDomain = yield* call("POST", `${b}/domains`, {
          as: bob,
          body: { fqdn: ` ${run}.Bravo.example.test` },
        });
        expect(bobsDomain).toMatchObject({
          body: { fqdn: `${run}.bravo.example.test` },
          status: 200,
        });
        const domainId = (bobsDomain.body as { id: string }).id;
        const bobsTemplate = yield* call("POST", `${b}/templates`, {
          as: bob,
          body: { name: "Welcome" },
        });
        expect(bobsTemplate.status).toBe(200);
        const templateId = (bobsTemplate.body as { id: string }).id;
        const bobsKey = yield* call("POST", `${b}/api-keys`, { as: bob, body: { name: "Bob" } });
        expect(bobsKey.status).toBe(200);
        const keyId = (bobsKey.body as { apiKey: { id: string } }).apiKey.id;
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        const [workspace] = yield* Effect.promise(() =>
          db
            .insert(templatingWorkspace)
            .values({
              kind: "reactEmail",
              organizationId: projectB.id,
              source: "hosted",
              updatedAt: new Date(),
            })
            .returning(),
        );
        const [entry] = yield* Effect.promise(() =>
          db
            .insert(templatingWorkspaceEntry)
            .values({
              artifactStorageKey: "artifacts/welcome",
              path: "reactEmail/welcome.tsx",
              workspaceId: workspace?.id ?? "",
            })
            .returning(),
        );
        yield* Effect.promise(() => db.$client.end());

        // Alice is no member of Bob's Project: every operation on it is refused.
        for (const [method, path, body] of [
          ["GET", `${b}/api-keys`],
          ["POST", `${b}/api-keys`, { name: "Mine" }],
          ["PATCH", `${b}/api-keys/${keyId}`, { name: "Mine" }],
          ["DELETE", `${b}/api-keys/${keyId}`],
          ["GET", `${b}/domains`],
          ["POST", `${b}/domains`, { fqdn: "alice.example.test" }],
          ["POST", `${b}/domains/${domainId}/refresh`],
          ["DELETE", `${b}/domains/${domainId}`],
          ["POST", `${b}/domains/${domainId}/pause`, { reason: "manual_admin_pause" }],
          ["POST", `${b}/domains/${domainId}/unpause`],
          ["GET", `${b}/templates`],
          ["GET", `${b}/templates/${templateId}`],
          ["POST", `${b}/templates`, { name: "Mine" }],
          ["POST", `${b}/templates/${templateId}/archive`],
          ["PATCH", `${b}/templates/${templateId}`, { slug: "mine" }],
          [
            "PUT",
            `${b}/templates/${templateId}/email`,
            { subject: "Hi", workspaceEntryId: entry?.id },
          ],
          ["GET", `${b}/workspaces/reactEmail`],
          ["GET", `${b}/workspaces/reactEmail/entries`],
          ["GET", `${b}/workspaces/reactEmail/files`],
          ["GET", `${b}/workspaces/reactEmail/files/content?path=a.tsx`],
          ["POST", `${b}/workspaces/reactEmail/commits`, { changes: {} }],
          ["POST", `${b}/workspaces/reactEmail/sync-dependencies`],
          ["POST", `${b}/workspaces/reactEmail/publish`],
          ["POST", `${b}/workspaces/reactEmail/entries/${entry?.id}/preview`, {}],
          ["GET", `/projects/no-such-project/domains`],
        ] as const) {
          expect([method, path, (yield* call(method, path, { as: alice, body })).status]).toEqual([
            method,
            path,
            403,
          ]);
        }

        // Nor do ids from Bob's Project reach anything through Alice's own.
        const aliceTemplate = yield* call("POST", `${a}/templates`, {
          as: alice,
          body: { name: "Welcome" },
        });
        const aliceTemplateId = (aliceTemplate.body as { id: string }).id;
        for (const [method, path, body] of [
          ["PATCH", `${a}/api-keys/${keyId}`, { name: "Mine" }],
          ["DELETE", `${a}/api-keys/${keyId}`],
          ["POST", `${a}/domains/${domainId}/refresh`],
          ["DELETE", `${a}/domains/${domainId}`],
          ["POST", `${a}/domains/${domainId}/pause`, { reason: "manual_admin_pause" }],
          ["POST", `${a}/domains/${domainId}/unpause`],
          ["GET", `${a}/templates/${templateId}`],
          ["POST", `${a}/templates/${templateId}/archive`],
          ["PATCH", `${a}/templates/${templateId}`, { slug: "mine" }],
          [
            "PUT",
            `${a}/templates/${aliceTemplateId}/email`,
            { subject: "Hi", workspaceEntryId: entry?.id },
          ],
        ] as const) {
          expect([method, path, (yield* call(method, path, { as: alice, body })).status]).toEqual([
            method,
            path,
            404,
          ]);
        }
        expect((yield* call("GET", `${a}/api-keys`, { as: alice })).body).toEqual([]);
        expect((yield* call("GET", `${a}/domains`, { as: alice })).body).toEqual([]);

        // Bob's data is still his.
        expect((yield* call("GET", `${b}/domains`, { as: bob })).body).toHaveLength(1);
        expect(
          (yield* call("GET", `${b}/templates/${templateId}`, { as: bob })).body,
        ).toMatchObject({ archivedAt: null, slug: "welcome" });
        expect((yield* call("GET", `${b}/api-keys`, { as: bob })).body).toMatchObject([
          { createdBy: { name: "bob" }, id: keyId, name: "Bob" },
        ]);

        // Carol is a plain member of Alice's Project: she reads, and changes nothing.
        const carolUser = yield* Effect.promise(() =>
          auth.api.getSession({ headers: new Headers({ cookie: carol }) }),
        );
        yield* Effect.promise(() =>
          auth.api.addMember({
            body: { organizationId: projectA.id, role: "member", userId: carolUser?.user.id ?? "" },
          }),
        );
        for (const path of [`${a}/api-keys`, `${a}/domains`, `${a}/templates`]) {
          expect((yield* call("GET", path, { as: carol })).status).toBe(200);
        }
        for (const [method, path, body] of [
          ["POST", `${a}/api-keys`, { name: "Carol" }],
          ["DELETE", `${a}/api-keys/key_unknown`],
          ["POST", `${a}/domains`, { fqdn: "carol.example.test" }],
          ["POST", `${a}/templates`, { name: "Carol" }],
          ["PATCH", `${a}/templates/${aliceTemplateId}`, { slug: "carol" }],
          ["POST", `${a}/workspaces/reactEmail/publish`],
        ] as const) {
          expect([method, path, (yield* call(method, path, { as: carol, body })).status]).toEqual([
            method,
            path,
            403,
          ]);
        }

        // A change from another site is refused even with the cookie.
        expect(
          (yield* call("POST", `${a}/templates`, {
            as: alice,
            body: { name: "Forged" },
            origin: "https://evil.test",
          })).status,
        ).toBe(403);
        // So is one that names no origin: browsers always send it on a change.
        const forged = yield* Effect.gen(function* () {
          const origin = yield* Origin;
          return yield* Effect.promise(() =>
            fetch(`${origin}${a}/templates`, {
              body: JSON.stringify({ name: "Forged" }),
              headers: { "content-type": "application/json", cookie: alice },
              method: "POST",
            }),
          );
        });
        expect(forged.status).toBe(403);

        // An API key is no way in, even with Alice's own key beside her cookie.
        const aliceKey = yield* call("POST", `${a}/api-keys`, { as: alice, body: { name: "K" } });
        const { key } = aliceKey.body as { key: string };
        const withKey = yield* Effect.gen(function* () {
          const origin = yield* Origin;
          return yield* Effect.promise(async () => {
            const response = await fetch(`${origin}${a}/domains`, {
              headers: { cookie: alice, "x-api-key": key },
            });
            return { body: (await response.json()) as unknown, status: response.status };
          });
        });
        expect(withKey).toEqual({
          body: {
            _tag: "Unauthenticated",
            message: "This endpoint takes a dashboard session, not an API key.",
          },
          status: 401,
        });
      }),
    );

    it.effect("lets an owner run each operation, and answers 503 for the missing builder", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("owner");
        const project = yield* createProject(owner, "Admin");
        // `admin` is the dashboard's own page, so the Project is given another slug.
        expect(project.slug).toMatch(/^admin-project(-\d+)?$/);
        const p = `/projects/${project.slug}`;

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const created = yield* call("POST", `${p}/api-keys`, {
          as: owner,
          body: { expiresAt: expiresAt.toISOString(), name: "Server" },
        });
        expect(created).toMatchObject({ body: { apiKey: { name: "Server" } }, status: 200 });
        const expires = (created.body as { apiKey: { expiresAt: string } }).apiKey.expiresAt;
        expect(Math.abs(new Date(expires).getTime() - expiresAt.getTime())).toBeLessThan(5000);
        const { apiKey, key } = created.body as { apiKey: { id: string }; key: string };
        expect(key.startsWith("rel_org_")).toBe(true);
        expect(
          yield* call("PATCH", `${p}/api-keys/${apiKey.id}`, {
            as: owner,
            body: { name: "Renamed" },
          }),
        ).toMatchObject({ body: { end: key.slice(-6), name: "Renamed" }, status: 200 });
        expect((yield* call("DELETE", `${p}/api-keys/${apiKey.id}`, { as: owner })).status).toBe(
          204,
        );
        expect((yield* call("GET", `${p}/api-keys`, { as: owner })).body).toEqual([]);

        const domain = yield* call("POST", `${p}/domains`, {
          as: owner,
          body: { fqdn: `${run}.owner.example.test` },
        });
        expect(domain.status).toBe(200);
        const domainId = (domain.body as { id: string }).id;
        expect(
          yield* call("POST", `${p}/domains/${domainId}/refresh`, { as: owner }),
        ).toMatchObject({ body: { verificationStatus: "verified" }, status: 200 });
        expect(
          (yield* call("POST", `${p}/domains`, { as: owner, body: { fqdn: "not a domain" } }))
            .status,
        ).toBe(400);
        expect((yield* call("DELETE", `${p}/domains/${domainId}`, { as: owner })).status).toBe(204);

        const template = yield* call("POST", `${p}/templates`, {
          as: owner,
          body: { name: "Receipt" },
        });
        const templateId = (template.body as { id: string }).id;
        expect(
          yield* call("PATCH", `${p}/templates/${templateId}`, {
            as: owner,
            body: { slug: "Order Receipt" },
          }),
        ).toMatchObject({ body: { slug: "order-receipt" }, status: 200 });
        expect(
          yield* call("POST", `${p}/templates/${templateId}/archive`, { as: owner }),
        ).toMatchObject({ status: 200 });
        expect(
          yield* call("PATCH", `${p}/templates/${templateId}`, {
            as: owner,
            body: { slug: "again" },
          }),
        ).toMatchObject({ body: { _tag: "Conflict" }, status: 409 });

        expect(yield* call("GET", `${p}/workspaces/reactEmail/entries`, { as: owner })).toEqual({
          body: [],
          cookies: [],
          status: 200,
        });
        expect(yield* call("GET", `${p}/workspaces/reactEmail/files`, { as: owner })).toMatchObject(
          {
            body: {
              _tag: "Unavailable",
              message: "Email Workspaces aren't available on this deployment.",
            },
            status: 503,
          },
        );
      }),
    );

    it.effect("signs in only from the dashboard's origin, and grants CORS to it alone", () =>
      Effect.gen(function* () {
        yield* signUp("cors");
        const signIn = (origin: string, callbackURL: string) =>
          call("POST", "/auth/sign-in/email", {
            body: { callbackURL, email: `cors-${run}@example.test`, password: "a-long-password" },
            origin,
          });
        expect((yield* signIn("https://evil.test", `${APP}/`)).status).toBe(403);
        // Sign-in only ever returns to the dashboard.
        expect((yield* signIn(APP, "https://evil.test/")).status).toBe(403);
        const signedIn = yield* signIn(APP, `${APP}/acme`);
        expect(signedIn.status).toBe(200);
        // Lax, not None: the dashboard and the api must be one site (app. and api. of a
        // domain, or two ports of localhost), and the cookie stays off other sites' requests.
        const sessionCookie = signedIn.cookies.find((c) => c.startsWith("relayit.session_token="));
        expect(sessionCookie).toMatch(/; HttpOnly/i);
        expect(sessionCookie).toMatch(/; SameSite=Lax/i);
        const cookie = signedIn.cookies.map((c) => c.split(";")[0]).join("; ");

        const origin = yield* Origin;
        const session = (from: string) =>
          Effect.promise(() =>
            fetch(`${origin}/auth/get-session`, { headers: { cookie, origin: from } }),
          );
        const fromApp = yield* session(APP);
        expect(fromApp.headers.get("access-control-allow-origin")).toBe(APP);
        expect(fromApp.headers.get("access-control-allow-credentials")).toBe("true");
        expect(yield* Effect.promise(() => fromApp.json())).toMatchObject({
          user: { email: `cors-${run}@example.test` },
        });
        const fromElsewhere = yield* session("https://evil.test");
        expect(fromElsewhere.headers.get("access-control-allow-origin")).toBeNull();
      }),
    );

    it.effect("sends a sign-in failure with nowhere else to go to the dashboard's sign-in", () =>
      Effect.gen(function* () {
        const origin = yield* Origin;
        const location = (path: string) =>
          Effect.promise(async () => {
            const response = await fetch(`${origin}${path}`, { redirect: "manual" });
            return { location: response.headers.get("location") ?? "", status: response.status };
          });
        // GitHub returning to the api without the state the sign-in started with.
        const stateless = yield* location("/auth/callback/github?code=c");
        expect(stateless.status).toBe(302);
        expect(stateless.location.startsWith(`${APP}/auth/sign-in?error=`)).toBe(true);
        expect(yield* location("/auth/error?error=access_denied")).toEqual({
          location: `${APP}/auth/sign-in?error=access_denied`,
          status: 302,
        });
      }),
    );

    it.effect("gives a new Project a slug of letters, digits and hyphens from its name", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("slugger");
        const dotted = yield* createProject(owner, `Acme.io ${run.slice(-8)}`);
        expect(dotted.slug).toBe(`acme-io-${run.slice(-8).toLowerCase()}`);
        // A name the dashboard answers at its root gets another slug.
        expect((yield* createProject(owner, "Admin")).slug).toMatch(/^admin-project(-\d+)?$/);
        // A name that is only punctuation still gets a usable slug.
        expect((yield* createProject(owner, "...")).slug).toMatch(/^project(-\d+)?$/);
      }),
    );

    it.effect("refuses a slug outside the rule wherever a Project is created or renamed", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("renamer");
        const project = yield* createProject(owner, `Renamer ${run.slice(-8)}`);
        const rename = (slug: string) =>
          call("POST", "/auth/organization/update", {
            as: owner,
            body: { data: { slug }, organizationId: project.id },
          });
        for (const slug of [
          "admin",
          "acme.io",
          "Acme",
          "acme--mail",
          "-acme",
          "a",
          "x".repeat(49),
        ]) {
          expect([slug, (yield* rename(slug)).status]).toEqual([slug, 400]);
        }
        expect(yield* rename("acme.io")).toMatchObject({
          body: {
            message:
              "A Project slug is lowercase letters, digits and hyphens, with no hyphen at either end or two together.",
          },
        });
        const valid = `renamed-${run.slice(-8).toLowerCase()}`;
        expect(yield* rename(valid)).toMatchObject({ body: { slug: valid }, status: 200 });
        // Renaming only the name leaves the slug alone, and is not refused.
        expect(
          yield* call("POST", "/auth/organization/update", {
            as: owner,
            body: { data: { name: "Renamed" }, organizationId: project.id },
          }),
        ).toMatchObject({ body: { slug: valid }, status: 200 });

        // better-auth's own create endpoint is held to the same rule.
        const create = (slug: string) =>
          call("POST", "/auth/organization/create", {
            as: owner,
            body: { name: "Direct", slug },
          });
        expect((yield* create(`direct.${run.slice(-8).toLowerCase()}`)).status).toBe(400);
        expect((yield* create("user")).status).toBe(400);
        expect(yield* create(`direct-${run.slice(-8).toLowerCase()}`)).toMatchObject({
          status: 200,
        });
      }),
    );
  });
});
