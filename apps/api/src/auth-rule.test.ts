/**
 * The rule that keeps the api's two kinds of route apart on one namespace. The public API
 * (`Api`) takes an API key and sends no CORS headers: it is called by servers, never from a
 * page. The dashboard's operations (`DashboardApi`) take the session cookie and nothing
 * else, grant the dashboard's origin (`APP_URL`) CORS with credentials, and refuse a change
 * from any other origin. Both are checked over every endpoint of each contract, so a new one
 * is covered the moment it is added; `/auth/*` and `/unsubscribe/*`, which the dashboard
 * also calls, are checked by path.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  DashboardApi,
  DashboardSession,
  PlatformAdmin,
  ProjectAccess,
  RequiresPermission,
} from "@repo/contracts/dashboard";
import { Context, Effect } from "effect";
import { HttpApi, type HttpApiGroup } from "effect/http-api";
import { Api, ApiKeyAuth, LegacyApiKeyAuth } from "./api";
import { APP_ORIGIN, GOOD_KEY, serve, stubs } from "./testing";

const OTHER_ORIGIN = "https://evil.test";

interface Reflected {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  /** The keys of the middleware in front of it. */
  readonly middleware: ReadonlySet<string>;
  /** Whether it declares the permission a member's role must grant. */
  readonly declaresPermission: boolean;
}

const endpointsOf = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
) => {
  const endpoints: Reflected[] = [];
  HttpApi.reflect(api, {
    onEndpoint: ({ endpoint, group, middleware }) =>
      endpoints.push({
        declaresPermission:
          Context.getOption(endpoint.annotations, RequiresPermission)._tag === "Some",
        method: endpoint.method,
        middleware: new Set([...middleware].map((service) => service.key)),
        name: `${group.identifier}.${endpoint.identifier}`,
        path: endpoint.path,
      }),
    onGroup: () => undefined,
  });
  return endpoints;
};

/** The one dashboard endpoint without a session: read before sign-in. */
const SESSIONLESS = new Set(["config.get"]);
/** Public endpoints authenticated otherwise: SNS signs its notifications. */
const KEYLESS = new Set(["health.health", "sesNotifications.receive"]);

/** A path with its parameters filled with values the routes accept. */
const concrete = (path: string) =>
  path
    .replace(":orgSlug", "acme")
    .replace(":project", "acme")
    .replace(":kind", "reactEmail")
    .replaceAll(/:\w+/g, "id_1");

const send = (url: string, init: RequestInit) =>
  Effect.promise(async () => {
    const response = await fetch(url, init);
    const text = await response.text();
    return {
      allowCredentials: response.headers.get("access-control-allow-credentials"),
      allowMethods: response.headers.get("access-control-allow-methods"),
      allowOrigin: response.headers.get("access-control-allow-origin"),
      body: text,
      status: response.status,
    };
  });

const preflight = (origin: string, from: string, path: string) =>
  send(`${origin}${path}`, {
    headers: {
      "access-control-request-headers": "content-type",
      "access-control-request-method": "POST",
      origin: from,
    },
    method: "OPTIONS",
  });

describe("the auth rule", () => {
  it("puts every dashboard endpoint but /config behind the session, and none in the public API", () => {
    for (const endpoint of endpointsOf(DashboardApi)) {
      const sessioned =
        endpoint.middleware.has(DashboardSession.key) ||
        endpoint.middleware.has(ProjectAccess.key) ||
        endpoint.middleware.has(PlatformAdmin.key);
      expect([endpoint.name, sessioned]).toEqual([endpoint.name, !SESSIONLESS.has(endpoint.name)]);
      expect([endpoint.name, endpoint.middleware.has(ApiKeyAuth.key)]).toEqual([
        endpoint.name,
        false,
      ]);
    }
    for (const endpoint of endpointsOf(Api)) {
      const keyed =
        endpoint.middleware.has(ApiKeyAuth.key) || endpoint.middleware.has(LegacyApiKeyAuth.key);
      expect([endpoint.name, keyed]).toEqual([endpoint.name, !KEYLESS.has(endpoint.name)]);
      expect([
        endpoint.name,
        endpoint.middleware.has(DashboardSession.key) ||
          endpoint.middleware.has(ProjectAccess.key) ||
          endpoint.middleware.has(PlatformAdmin.key),
      ]).toEqual([endpoint.name, false]);
    }
  });

  // ProjectAccess lets any member through an endpoint that declares no permission.
  it("makes every Project endpoint declare the permission it needs", () => {
    for (const endpoint of endpointsOf(DashboardApi)) {
      if (endpoint.middleware.has(ProjectAccess.key)) {
        expect([endpoint.name, endpoint.declaresPermission]).toEqual([endpoint.name, true]);
      }
    }
  });

  it.live("serves every dashboard endpoint with CORS for the dashboard alone", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      for (const endpoint of endpointsOf(DashboardApi)) {
        const path = concrete(endpoint.path);
        const label = `${endpoint.method} ${path}`;
        expect([label, yield* preflight(origin, APP_ORIGIN, path)]).toMatchObject([
          label,
          { allowCredentials: "true", allowOrigin: APP_ORIGIN, status: 204 },
        ]);
        expect([label, (yield* preflight(origin, OTHER_ORIGIN, path)).allowOrigin]).toEqual([
          label,
          null,
        ]);

        const body = endpoint.method === "GET" ? undefined : "{}";
        const headers = { "content-type": "application/json", origin: APP_ORIGIN };
        const fromApp = yield* send(`${origin}${path}`, {
          body,
          headers,
          method: endpoint.method,
        });
        expect([label, fromApp]).toMatchObject([
          label,
          {
            allowCredentials: "true",
            allowOrigin: APP_ORIGIN,
            status: SESSIONLESS.has(endpoint.name) ? 200 : 401,
          },
        ]);
        const fromOther = yield* send(`${origin}${path}`, {
          body,
          headers: { ...headers, origin: OTHER_ORIGIN },
          method: endpoint.method,
        });
        expect([label, fromOther.allowOrigin]).toEqual([label, null]);
        if (SESSIONLESS.has(endpoint.name)) {
          continue;
        }
        if (endpoint.method !== "GET") {
          expect([label, fromOther.status]).toEqual([label, 403]);
        }
        // An API key is refused outright, not ignored in favour of the cookie.
        const withKey = yield* send(`${origin}${path}`, {
          body,
          headers: { ...headers, "x-api-key": GOOD_KEY },
          method: endpoint.method,
        });
        expect([label, withKey.status, JSON.parse(withKey.body)]).toEqual([
          label,
          401,
          {
            _tag: "Unauthenticated",
            message: "This endpoint takes a dashboard session, not an API key.",
          },
        ]);
      }
    }),
  );

  it.live("sends no CORS headers on the public API, even to the dashboard's origin", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      for (const endpoint of endpointsOf(Api)) {
        const path = concrete(endpoint.path);
        expect([path, yield* preflight(origin, APP_ORIGIN, path)]).toMatchObject([
          path,
          { allowOrigin: null, status: 404 },
        ]);
      }
      expect(
        yield* send(`${origin}/messages/email`, {
          body: JSON.stringify({
            from: "hello@acme.test",
            html: "<p>Hi</p>",
            subject: "Hi",
            to: "jane@example.com",
          }),
          headers: {
            "content-type": "application/json",
            origin: APP_ORIGIN,
            "x-api-key": GOOD_KEY,
          },
          method: "POST",
        }),
      ).toMatchObject({ allowCredentials: null, allowOrigin: null, status: 201 });
      expect(yield* send(`${origin}/health`, { headers: { origin: APP_ORIGIN } })).toMatchObject({
        allowOrigin: null,
        status: 200,
      });
    }),
  );

  it.live("answers better-auth's and unsubscribe's preflights for the dashboard alone", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      for (const path of ["/auth/sign-in/email", "/unsubscribe/acme/cont_1?msg=m&topic=t&sig=s"]) {
        const fromApp = yield* preflight(origin, APP_ORIGIN, path);
        expect(fromApp).toMatchObject({
          allowCredentials: "true",
          allowOrigin: APP_ORIGIN,
          status: 204,
        });
        expect(fromApp.allowMethods).toContain("POST");
        expect(yield* preflight(origin, OTHER_ORIGIN, path)).toMatchObject({ allowOrigin: null });
      }
    }),
  );
});
