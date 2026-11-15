/**
 * CORS: the dashboard runs on its own origin and calls the api with the session cookie, so
 * its paths grant that origin, with credentials, and no other. The public API sends no CORS
 * headers at all (`contract.test.ts` pins its preflight 404).
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { APP_ORIGIN, GOOD_KEY, serve, stubs } from "./testing";

const send = (url: string, init: RequestInit) =>
  Effect.promise(async () => {
    const response = await fetch(url, init);
    return {
      allowCredentials: response.headers.get("access-control-allow-credentials"),
      allowMethods: response.headers.get("access-control-allow-methods"),
      allowOrigin: response.headers.get("access-control-allow-origin"),
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

describe("CORS", () => {
  it.live("answers the dashboard's preflights for its origin alone", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      for (const path of [
        "/dashboard/projects",
        "/auth/sign-in/email",
        "/unsubscribe/acme/cont_1?msg=m&topic=t&sig=s",
      ]) {
        expect(yield* preflight(origin, APP_ORIGIN, path)).toMatchObject({
          allowCredentials: "true",
          allowOrigin: APP_ORIGIN,
          status: 204,
        });
        expect((yield* preflight(origin, APP_ORIGIN, path)).allowMethods).toContain("POST");
        expect(yield* preflight(origin, "https://evil.test", path)).toMatchObject({
          allowOrigin: null,
        });
      }
    }),
  );

  // Whether a request with the cookie is let through is the session's business
  // (`dashboard/dashboard.integration.test.ts`); this is whether a page may read the answer.
  it.live("lets the dashboard's origin read a response with the cookie, and no other", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const config = (from: string) =>
        send(`${origin}/dashboard/config`, { headers: { origin: from } });
      expect(yield* config(APP_ORIGIN)).toMatchObject({
        allowCredentials: "true",
        allowOrigin: APP_ORIGIN,
        status: 200,
      });
      expect(yield* config("https://evil.test")).toMatchObject({ allowOrigin: null, status: 200 });
    }),
  );

  it.live("sends no CORS headers on the public API, even to the dashboard's origin", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
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
      expect(yield* preflight(origin, APP_ORIGIN, "/messages/email")).toMatchObject({
        allowOrigin: null,
        status: 404,
      });
    }),
  );
});
