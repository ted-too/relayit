/**
 * The dashboard's operations over the real api server, better-auth and Postgres, with the
 * fake email backend and no template builder. The point is authorisation: every group
 * refuses a request without a session, a Project's operations refuse anyone who isn't its
 * member, a member's role decides what they may change, and a Project id taken from
 * another Project reaches nothing.
 */
import { describe, expect, layer, test } from "@effect/vitest";
import { setBanned, setPlatformAdmin } from "@repo/persistence/auth/platform-admin";
import { ensureUserLimits } from "@repo/persistence/auth/plans";
import { createPromiseDb } from "@repo/persistence/db/promise";
import {
  emailDomainRegistration,
  sandboxDomain,
  templatingWorkspace,
  templatingWorkspaceEntry,
  user,
} from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
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

  /**
   * One request, read whole. `as` is a session cookie, `key` an API key; changes come from
   * the dashboard.
   */
  const call = (
    method: string,
    path: string,
    options: {
      readonly as?: string;
      readonly body?: unknown;
      readonly key?: string;
      readonly origin?: string;
    } = {},
  ) =>
    Effect.gen(function* () {
      const origin = yield* Origin;
      return yield* Effect.promise(async () => {
        const response = await fetch(`${origin}${path}`, {
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          headers: {
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            ...(options.as === undefined ? {} : { cookie: options.as }),
            ...(options.key === undefined ? {} : { "x-api-key": options.key }),
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

  /** A platform admin's session cookie, the role granted as an operator grants it. */
  const signUpAdmin = (name: string) =>
    Effect.gen(function* () {
      const { auth } = yield* ApiAuth;
      const cookie = yield* signUp(name);
      yield* setPlatformAdmin(auth, { admin: true, email: `${name}-${run}@example.test` });
      return cookie;
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
          ["GET", "/admin/projects"],
          ["POST", "/admin/domains/dom_1/pause"],
          ["POST", "/admin/domains/dom_1/unpause"],
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

    it.effect("lets a claim send from, change or see the holder's Domain only once proven", () =>
      Effect.gen(function* () {
        const holder = yield* signUp("holder");
        const claimant = yield* signUp("claimant");
        const operator = yield* signUpAdmin("claim-operator");
        const holderProject = yield* createProject(holder, `Holder ${run.slice(-8)}`);
        const claimantProject = yield* createProject(claimant, `Claimant ${run.slice(-8)}`);
        const h = `/projects/${holderProject.slug}`;
        const c = `/projects/${claimantProject.slug}`;
        const fqdn = `${run}.claimed.example.test`;
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        const domainRow = (id: string) =>
          Effect.promise(() =>
            db.query.customDomain.findFirst({
              columns: { isPaused: true, lastCheckedAt: true, pausedReason: true },
              where: { id },
            }),
          );
        const keyFor = (as: string, path: string) =>
          Effect.gen(function* () {
            const created = yield* call("POST", `${path}/api-keys`, { as, body: { name: "K" } });
            return (created.body as { key: string }).key;
          });
        const sendFrom = (key: string, from: string) =>
          call("POST", "/messages/email", {
            body: { from, subject: "Hi", text: "Hi", to: "someone@example.test" },
            key,
          });

        // The holder adds the Domain and it verifies: the holder sends from it.
        const added = yield* call("POST", `${h}/domains`, { as: holder, body: { fqdn } });
        const domainId = (added.body as { id: string }).id;
        expect(
          yield* call("POST", `${h}/domains/${domainId}/refresh`, { as: holder }),
        ).toMatchObject({ body: { verificationStatus: "verified" }, status: 200 });
        const holderKey = yield* keyFor(holder, h);
        expect((yield* sendFrom(holderKey, `hello@${fqdn}`)).status).toBe(201);
        expect(
          (yield* call("POST", `/admin/domains/${domainId}/pause`, {
            as: operator,
            body: { reason: "manual_admin_pause" },
          })).status,
        ).toBe(204);

        // The claimant adds it too: a claim, which shows only how to prove it.
        const claimView = {
          dnsRecords: {
            dkimAndSpf: [],
            dmarc: [],
            ownership: [{ purpose: "ownership", recordType: "TXT", status: "pending" }],
          },
          fqdn,
          id: domainId,
          isPaused: false,
          lastCheckedAt: null,
          ownership: { status: "pending" },
          pausedReason: null,
          verificationStatus: "not_verified",
        };
        expect(yield* call("POST", `${c}/domains`, { as: claimant, body: { fqdn } })).toMatchObject(
          { body: claimView, status: 200 },
        );
        expect(yield* call("GET", `${c}/domains`, { as: claimant })).toMatchObject({
          body: [claimView],
          status: 200,
        });

        // It sends from the Domain neither through /messages/email nor the legacy path.
        expect(
          (yield* call("POST", `/admin/domains/${domainId}/unpause`, { as: operator })).status,
        ).toBe(204);
        const claimantKey = yield* keyFor(claimant, c);
        expect(yield* sendFrom(claimantKey, `hello@${fqdn}`)).toMatchObject({
          body: { code: "invalid_from_address" },
          status: 422,
        });
        const legacyBody = { payload: { subject: "Hi", text: "Hi" }, to: "someone@example.test" };
        expect(
          yield* call("POST", `/send/${claimantProject.slug}/raw/email`, {
            body: { ...legacyBody, from: `hello@${fqdn}` },
            key: claimantKey,
          }),
        ).toMatchObject({ body: { details: ["invalid_from_address"] }, status: 400 });
        // Nor is it the Project's default From for a legacy send that names none.
        expect(
          yield* call("POST", `/send/${claimantProject.slug}/raw/email`, {
            body: legacyBody,
            key: claimantKey,
          }),
        ).toMatchObject({
          body: { message: "No sender identity available; pass from or provision Sandbox Domain" },
          status: 400,
        });
        expect((yield* sendFrom(holderKey, `hello@${fqdn}`)).status).toBe(201);

        // Its refresh must leave a pause on the holder's Domain as it is.
        yield* call("POST", `/admin/domains/${domainId}/pause`, {
          as: operator,
          body: { reason: "manual_admin_pause" },
        });
        const before = yield* domainRow(domainId);
        expect(before).toMatchObject({ isPaused: true, pausedReason: "manual_admin_pause" });

        // Its refresh checks its own proof and nothing of the holder's Domain. The fake
        // backend finds every record published, so the proof holds and the Domain moves.
        expect(
          yield* call("POST", `${c}/domains/${domainId}/refresh`, { as: claimant }),
        ).toMatchObject({
          body: {
            isPaused: true,
            ownership: { status: "active" },
            pausedReason: "manual_admin_pause",
          },
          status: 200,
        });
        expect(yield* domainRow(domainId)).toEqual(before);
        expect((yield* call("GET", `${h}/domains`, { as: holder })).body).toEqual([]);
        expect(
          (yield* call("POST", `/admin/domains/${domainId}/unpause`, { as: operator })).status,
        ).toBe(204);
        expect((yield* sendFrom(claimantKey, `hello@${fqdn}`)).status).toBe(201);
        expect(yield* sendFrom(holderKey, `hello@${fqdn}`)).toMatchObject({
          body: { code: "invalid_from_address" },
          status: 422,
        });
        yield* Effect.promise(() => db.$client.end());
      }),
    );

    it.effect("pauses a Domain for a platform admin alone, and rejects its sends meanwhile", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("pause-owner");
        // An admin of the platform, and a member of no Project.
        const operator = yield* signUpAdmin("pause-operator");
        const project = yield* createProject(owner, `Pauser ${run.slice(-8)}`);
        const p = `/projects/${project.slug}`;
        const fqdn = `${run}.paused.example.test`;
        const added = yield* call("POST", `${p}/domains`, { as: owner, body: { fqdn } });
        const domainId = (added.body as { id: string }).id;
        yield* call("POST", `${p}/domains/${domainId}/refresh`, { as: owner });
        const created = yield* call("POST", `${p}/api-keys`, { as: owner, body: { name: "K" } });
        const { key } = created.body as { key: string };
        const send = call("POST", "/messages/email", {
          body: { from: `hello@${fqdn}`, subject: "Hi", text: "Hi", to: "someone@example.test" },
          key,
        });
        const listed = call("GET", `${p}/domains`, { as: owner });
        const pause = (as: string, reason: string) =>
          call("POST", `/admin/domains/${domainId}/pause`, { as, body: { reason } });
        const unpause = (as: string) => call("POST", `/admin/domains/${domainId}/unpause`, { as });

        // The Project's owner is no platform admin: every admin operation refuses them, and
        // the Project's own pause and unpause routes are gone.
        const refused = { body: { _tag: "Forbidden" }, status: 403 };
        expect(yield* pause(owner, "manual_admin_pause")).toMatchObject(refused);
        expect(yield* call("GET", "/admin/projects", { as: owner })).toMatchObject(refused);
        const origin = yield* Origin;
        for (const path of [`${p}/domains/${domainId}/pause`, `${p}/domains/${domainId}/unpause`]) {
          const gone = yield* Effect.promise(() =>
            fetch(`${origin}${path}`, {
              body: JSON.stringify({ reason: "manual_admin_pause" }),
              headers: { "content-type": "application/json", cookie: owner, origin: APP },
              method: "POST",
            }),
          );
          expect([path, gone.status]).toEqual([path, 404]);
        }
        expect(yield* listed).toMatchObject({
          body: [{ id: domainId, isPaused: false, pausedReason: null }],
          status: 200,
        });
        expect((yield* send).status).toBe(201);

        // A reason the contract doesn't name, a Domain that doesn't exist and a request from
        // another site are refused for an admin too.
        expect((yield* pause(operator, "because")).status).toBe(400);
        expect(
          yield* call("POST", "/admin/domains/dom_unknown/pause", {
            as: operator,
            body: { reason: "manual_admin_pause" },
          }),
        ).toMatchObject({ body: { _tag: "NotFound" }, status: 404 });
        expect(
          (yield* call("POST", "/admin/domains/dom_unknown/unpause", { as: operator })).status,
        ).toBe(404);
        expect(
          (yield* call("POST", `/admin/domains/${domainId}/pause`, {
            as: operator,
            body: { reason: "manual_admin_pause" },
            origin: "https://evil.test",
          })).status,
        ).toBe(403);
        expect((yield* listed).body).toMatchObject([{ id: domainId, isPaused: false }]);

        // The admin pauses a Domain of a Project they are no member of. The admin's list and
        // the owner's both say so and why, and accept rejects a send from it.
        expect((yield* pause(operator, "bad_reputation")).status).toBe(204);
        const adminProjects = (yield* call("GET", "/admin/projects", { as: operator })).body as {
          readonly domains: unknown;
          readonly id: string;
        }[];
        expect(adminProjects.find(({ id }) => id === project.id)).toMatchObject({
          domains: [
            {
              fqdn,
              id: domainId,
              isPaused: true,
              pausedReason: "bad_reputation",
              verificationStatus: "verified",
            },
          ],
          slug: project.slug,
        });
        expect((yield* listed).body).toMatchObject([
          { id: domainId, isPaused: true, pausedReason: "bad_reputation" },
        ]);
        expect(yield* send).toMatchObject({
          body: { code: "invalid_from_address" },
          status: 422,
        });

        // Nor does the owner unpause it.
        expect(yield* unpause(owner)).toMatchObject(refused);
        expect((yield* send).status).toBe(422);

        // An `admin` of the Project is no admin of the platform: the two share only a word.
        const { auth } = yield* ApiAuth;
        const projectAdmin = yield* signUp("pause-project-admin");
        const projectAdminUser = yield* Effect.promise(() =>
          auth.api.getSession({ headers: new Headers({ cookie: projectAdmin }) }),
        );
        yield* Effect.promise(() =>
          auth.api.addMember({
            body: {
              organizationId: project.id,
              role: "admin",
              userId: projectAdminUser?.user.id ?? "",
            },
          }),
        );
        expect((yield* call("GET", `${p}/domains`, { as: projectAdmin })).status).toBe(200);
        expect(yield* unpause(projectAdmin)).toMatchObject(refused);
        expect(yield* pause(projectAdmin, "manual_admin_pause")).toMatchObject(refused);
        expect(yield* call("GET", "/admin/projects", { as: projectAdmin })).toMatchObject(refused);
        expect((yield* send).status).toBe(422);

        // An admin banned straight in the database keeps a session and loses this, until
        // the ban lapses.
        const bannedAdmin = yield* signUpAdmin("pause-banned");
        const setBan = (banExpires: Date | null) =>
          Effect.promise(async () => {
            const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
            await db
              .update(user)
              .set({ banExpires, banned: true })
              .where(eq(user.email, `pause-banned-${run}@example.test`));
            await db.$client.end();
          });
        expect((yield* call("GET", "/admin/projects", { as: bannedAdmin })).status).toBe(200);
        yield* setBan(null);
        expect(yield* unpause(bannedAdmin)).toMatchObject(refused);
        expect(yield* call("GET", "/admin/projects", { as: bannedAdmin })).toMatchObject(refused);
        yield* setBan(new Date(Date.now() + 60 * 60 * 1000));
        expect(yield* unpause(bannedAdmin)).toMatchObject(refused);
        expect((yield* send).status).toBe(422);
        yield* setBan(new Date(Date.now() - 1000));
        expect((yield* call("GET", "/admin/projects", { as: bannedAdmin })).status).toBe(200);

        // An admin who is demoted loses it at once, whatever their session still says.
        const demoted = yield* signUpAdmin("pause-demoted");
        expect((yield* call("GET", "/admin/projects", { as: demoted })).status).toBe(200);
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        yield* Effect.promise(() =>
          db
            .update(user)
            .set({ role: "user" })
            .where(eq(user.email, `pause-demoted-${run}@example.test`)),
        );
        yield* Effect.promise(() => db.$client.end());
        expect(yield* unpause(demoted)).toMatchObject(refused);
        expect((yield* send).status).toBe(422);

        expect((yield* unpause(operator)).status).toBe(204);
        expect((yield* listed).body).toMatchObject([
          { id: domainId, isPaused: false, pausedReason: null },
        ]);
        expect((yield* send).status).toBe(201);
      }),
    );

    it.effect(
      "grants the platform admin role in a user's open sessions, and removal ends them",
      () =>
        Effect.gen(function* () {
          const { auth } = yield* ApiAuth;
          const email = `role-changed-${run}@example.test`;
          const signIn = Effect.gen(function* () {
            const signedIn = yield* call("POST", "/auth/sign-in/email", {
              body: { email, password: "a-long-password" },
            });
            expect(signedIn.status).toBe(200);
            return signedIn.cookies.map((cookie) => cookie.split(";")[0]).join("; ");
          });
          // Two sessions, both opened before the role changes.
          const open = [yield* signUp("role-changed"), yield* signIn];
          // Who each session is, then better-auth's own admin endpoints and the dashboard's.
          const seen = (sessions: readonly string[]) =>
            Effect.gen(function* () {
              const all: unknown[] = [];
              for (const as of sessions) {
                const session = (yield* call("GET", "/auth/get-session", { as })).body as {
                  readonly user: { readonly role: string };
                } | null;
                all.push([
                  session?.user.role ?? null,
                  (yield* call("GET", "/auth/admin/list-users", { as })).status,
                  (yield* call("GET", "/admin/projects", { as })).status,
                ]);
              }
              return all;
            });

          expect(yield* seen(open)).toEqual([
            ["user", 403, 403],
            ["user", 403, 403],
          ]);
          // Both sessions stay signed in and become an admin's.
          expect(yield* setPlatformAdmin(auth, { admin: true, email })).toEqual({ sessions: 2 });
          expect(yield* seen(open)).toEqual([
            ["admin", 200, 200],
            ["admin", 200, 200],
          ]);

          // Removal signs both out: no session, so 401 everywhere.
          expect(yield* setPlatformAdmin(auth, { admin: false, email })).toEqual({ sessions: 2 });
          expect(yield* seen(open)).toEqual([
            [null, 401, 401],
            [null, 401, 401],
          ]);
          // Signing in again gives a session that is no admin's.
          expect(yield* seen([yield* signIn])).toEqual([["user", 403, 403]]);

          expect(
            yield* Effect.flip(
              setPlatformAdmin(auth, { admin: true, email: `nobody-${run}@example.test` }),
            ),
          ).toMatchObject({ _tag: "PlatformAdminUserNotFound" });
        }),
    );

    it.effect(
      "refuses a banned user's open session on a Project's operations, until the ban is lifted",
      () =>
        Effect.gen(function* () {
          const { auth } = yield* ApiAuth;
          const email = `banned-${run}@example.test`;
          const signIn = call("POST", "/auth/sign-in/email", {
            body: { email, password: "a-long-password" },
          });
          const owner = yield* signUp("banned");
          const project = yield* createProject(owner, `Banned ${run.slice(-8)}`);
          const keys = (as: string) => call("GET", `/projects/${project.slug}/api-keys`, { as });
          expect((yield* keys(owner)).status).toBe(200);

          // The operator's ban, as `bun platform-admin.js ban` makes it: the session ends.
          expect(yield* setBanned(auth, { banned: true, email })).toEqual({ sessions: 1 });
          expect((yield* keys(owner)).status).toBe(401);
          expect(
            (yield* call("POST", "/projects", { as: owner, body: { name: "While banned" } }))
              .status,
          ).toBe(401);
          // better-auth's own endpoints go by the session too, and it is gone.
          expect((yield* call("GET", "/auth/get-session", { as: owner })).body).toBeNull();
          expect(yield* signIn).toMatchObject({ body: { code: "BANNED_USER" }, status: 403 });

          expect(yield* setBanned(auth, { banned: false, email })).toEqual({ sessions: 0 });
          const signedIn = yield* signIn;
          expect(signedIn.status).toBe(200);
          const again = signedIn.cookies.map((cookie) => cookie.split(";")[0]).join("; ");
          expect((yield* keys(again)).status).toBe(200);

          // A ban written straight to the database leaves the session open; the Project's
          // operations refuse it by the row, until the ban lapses.
          const setBan = (banned: boolean, banExpires: Date | null) =>
            Effect.promise(async () => {
              const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
              await db.update(user).set({ banExpires, banned }).where(eq(user.email, email));
              await db.$client.end();
            });
          const refused = { body: { message: "This account is banned." }, status: 403 };
          yield* setBan(true, null);
          expect(yield* keys(again)).toMatchObject(refused);
          expect(
            yield* call("POST", `/projects/${project.slug}/api-keys`, {
              as: again,
              body: { name: "While banned" },
            }),
          ).toMatchObject(refused);
          yield* setBan(true, new Date(Date.now() + 60 * 60 * 1000));
          expect(yield* keys(again)).toMatchObject(refused);
          yield* setBan(true, new Date(Date.now() - 1000));
          expect((yield* keys(again)).status).toBe(200);
          yield* setBan(true, null);
          expect(yield* keys(again)).toMatchObject(refused);
          // Lifting it with the command reaches the open session.
          expect(yield* setBanned(auth, { banned: false, email })).toEqual({ sessions: 1 });
          expect((yield* keys(again)).status).toBe(200);
        }),
    );

    it.effect("answers 404 to impersonation, for a platform admin too", () =>
      Effect.gen(function* () {
        const operator = yield* signUpAdmin("impersonator");
        const target = yield* signUp("impersonated");
        const { auth } = yield* ApiAuth;
        const targetId = (yield* Effect.promise(() =>
          auth.api.getSession({ headers: new Headers({ cookie: target }) }),
        ))?.user.id;
        expect(targetId).toBeDefined();
        // The admin endpoints beside it answer this admin; these two are not there, however
        // the path is spelt. better-auth answers them itself, in plain text.
        expect((yield* call("GET", "/auth/admin/list-users", { as: operator })).status).toBe(200);
        const origin = yield* Origin;
        for (const path of [
          "/auth/admin/impersonate-user",
          "/auth/admin/impersonate-user/",
          "/auth/admin/impersonate%2Duser",
          "/auth/admin//impersonate-user",
          "/auth//admin/impersonate-user",
          "/auth/admin/Impersonate-User",
          "/auth/admin/stop-impersonating",
        ]) {
          const response = yield* Effect.promise(() =>
            fetch(`${origin}${path}`, {
              body: JSON.stringify({ userId: targetId }),
              headers: { "content-type": "application/json", cookie: operator, origin: APP },
              method: "POST",
            }),
          );
          expect([path, response.status]).toEqual([path, 404]);
          expect(response.headers.getSetCookie()).toEqual([]);
        }
        // The admin is still who they were.
        expect((yield* call("GET", "/auth/get-session", { as: operator })).body).toMatchObject({
          user: { email: `impersonator-${run}@example.test` },
        });
      }),
    );

    it.effect("refuses a Sandbox Domain's root, and any name under it, as a Project's Domain", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("reserved");
        const project = yield* createProject(owner, `Reserved ${run.slice(-8)}`);
        const p = `/projects/${project.slug}`;
        const root = `${run}.sandbox.example.test`;
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        yield* Effect.promise(() =>
          db.insert(sandboxDomain).values({
            cloudflareZoneId: "zone",
            dkimPrivateKey: "private",
            dkimPublicKey: "public",
            dkimSelector: "relayit",
            rootDomain: root,
          }),
        );

        for (const fqdn of [root, ` ${root.toUpperCase()} `, `mail.${root}`]) {
          expect(yield* call("POST", `${p}/domains`, { as: owner, body: { fqdn } })).toMatchObject({
            body: { _tag: "Invalid" },
            status: 422,
          });
        }
        expect(yield* call("GET", `${p}/domains`, { as: owner })).toMatchObject({
          body: [],
          status: 200,
        });
        expect(
          yield* Effect.promise(() =>
            db.query.emailDomainRegistration.findMany({
              columns: { id: true },
              where: { customDomain: { fqdn: root } },
            }),
          ),
        ).toEqual([]);
        yield* Effect.promise(() => db.$client.end());
      }),
    );

    it.effect("refuses a Domain beyond the Plan's limit with a message a member can act on", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("limited");
        const project = yield* createProject(owner, `Limited ${run.slice(-8)}`);
        const p = `/projects/${project.slug}`;
        // The Free Plan's limits, as sign-in writes them on a deployment with Stripe.
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        yield* Effect.addFinalizer(() => Effect.promise(() => db.$client.end()));
        const billingUser = yield* Effect.promise(() =>
          db.query.user.findFirst({
            columns: { id: true },
            where: { email: `limited-${run}@example.test` },
          }),
        );
        yield* Effect.promise(() =>
          ensureUserLimits(db, { planName: "free", userId: billingUser?.id ?? "" }),
        );

        const first = yield* call("POST", `${p}/domains`, {
          as: owner,
          body: { fqdn: `${run}.first.limited.example.test` },
        });
        expect(first.status).toBe(200);
        expect(
          yield* call("POST", `${p}/domains`, {
            as: owner,
            body: { fqdn: `${run}.second.limited.example.test` },
          }),
        ).toEqual({
          body: {
            _tag: "PlanLimitReached",
            limit: 1,
            message:
              "The Billing User's Plan doesn't allow another Domain. It counts the Domains and pending claims of every Project billed to them: remove one, or upgrade the Plan.",
          },
          cookies: [],
          status: 402,
        });
        expect(yield* call("GET", `${p}/domains`, { as: owner })).toMatchObject({
          body: [{ fqdn: `${run}.first.limited.example.test` }],
          status: 200,
        });

        // Removing one makes room again.
        const firstId = (first.body as { id: string }).id;
        expect((yield* call("DELETE", `${p}/domains/${firstId}`, { as: owner })).status).toBe(204);
        expect(
          (yield* call("POST", `${p}/domains`, {
            as: owner,
            body: { fqdn: `${run}.second.limited.example.test` },
          })).status,
        ).toBe(200);
      }),
    );

    it.effect("finishes registering a Domain on refresh when its first add stopped short", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("unregistered");
        const project = yield* createProject(owner, `Unregistered ${run.slice(-8)}`);
        const p = `/projects/${project.slug}`;
        const added = yield* call("POST", `${p}/domains`, {
          as: owner,
          body: { fqdn: `${run}.unregistered.example.test` },
        });
        const domainId = (added.body as { id: string }).id;
        // As a first add leaves it when SES refuses the identity.
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        yield* Effect.promise(() =>
          db
            .delete(emailDomainRegistration)
            .where(eq(emailDomainRegistration.customDomainId, domainId)),
        );

        expect(
          yield* call("POST", `${p}/domains/${domainId}/refresh`, { as: owner }),
        ).toMatchObject({ body: { verificationStatus: "verified" }, status: 200 });
        expect(
          yield* Effect.promise(() =>
            db.query.emailDomainRegistration.findFirst({
              columns: { verificationStatus: true },
              where: { customDomainId: domainId },
            }),
          ),
        ).toEqual({ verificationStatus: "verified" });
        yield* Effect.promise(() => db.$client.end());
      }),
    );

    it.effect("removes a deleted Project's Domain and queues the delete of its SES identity", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("deleter");
        const project = yield* createProject(owner, `Deleted ${run.slice(-8)}`);
        const fqdn = `${run}.deleted.example.test`;
        const added = yield* call("POST", `/projects/${project.slug}/domains`, {
          as: owner,
          body: { fqdn },
        });
        expect(added.status).toBe(200);

        expect(
          (yield* call("POST", "/auth/organization/delete", {
            as: owner,
            body: { organizationId: project.id },
          })).status,
        ).toBe(200);

        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        expect(
          yield* Effect.promise(() =>
            db.query.customDomain.findFirst({ columns: { id: true }, where: { fqdn } }),
          ),
        ).toBeUndefined();
        // The worker deletes the identity; the job is in the outbox for it, naming the FQDN.
        const queued = yield* Effect.promise(() =>
          db.$client.query(
            "select 1 from job_outbox where job_name = 'email.delete-domain-identity' and position($1 in payload) > 0",
            [fqdn],
          ),
        );
        expect(queued.rows).toHaveLength(1);
        yield* Effect.promise(() => db.$client.end());
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

    it.effect("answers every first read of a new Project's Email Workspace", () =>
      Effect.gen(function* () {
        const owner = yield* signUp("opener");
        const project = yield* createProject(owner, `Opener ${run}`);

        // The page's reads arrive together, each finding no workspace row yet.
        const reads = yield* Effect.all(
          Array.from({ length: 8 }, () =>
            call("GET", `/projects/${project.slug}/workspaces/reactEmail/entries`, { as: owner }),
          ),
          { concurrency: "unbounded" },
        );

        expect(reads.map((read) => read.status)).toEqual(reads.map(() => 200));
        const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(templatingWorkspace)
            .where(eq(templatingWorkspace.organizationId, project.id)),
        );
        expect(rows).toHaveLength(1);
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
