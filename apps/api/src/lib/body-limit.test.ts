/**
 * The body limit every route is held to, over the real Bun server: a body over a route's
 * limit is refused before the route, its session check included, runs, and before the body
 * is read when it announces its length.
 */
import { describe, expect, it } from "@effect/vitest";
import { DashboardApi } from "@repo/contracts/dashboard";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { announced, APP_ORIGIN, request, serve, stubs } from "../testing";

const MIB = 1024 * 1024;
const JSON_TYPE = "application/json;charset=utf-8";
const UNSUBSCRIBE = "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=sig";
const COMMITS = "/projects/acme/workspaces/reactEmail/commits";

const tooLarge = (mib: number) =>
  JSON.stringify({
    _tag: "PayloadTooLarge",
    code: "payload_too_large",
    message: `Request body exceeds the ${mib} MiB limit.`,
  });

/** A body of `bytes` sent without a `Content-Length`. */
const chunked = (origin: string, path: string, bytes: number) =>
  Effect.promise(async () => {
    const response = await fetch(`${origin}${path}`, {
      body: new ReadableStream({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode("a".repeat(bytes)));
          controller.close();
        },
      }),
      duplex: "half",
      headers: { "content-type": "application/json", origin: APP_ORIGIN },
      method: "POST",
    });
    return {
      body: await response.text(),
      connection: response.headers.get("connection"),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  });

describe("the body limit on every route", () => {
  it.live("refuses an over-size body to an unsubscribe link without reading it", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const origin = yield* serve(
        stubs({
          unsubscribe: ({ contactId }) => {
            calls.push(contactId);
            return Effect.succeed({ contactId, ok: true as const, topicId: "topc_1" });
          },
        }).stubs,
      );

      expect(yield* announced(origin, UNSUBSCRIBE, {})).toMatchObject({
        body: tooLarge(1),
        status: "HTTP/1.1 413 Payload Too Large",
      });
      expect(calls).toEqual([]);

      // What a mailbox provider sends still unsubscribes.
      expect(
        yield* request(origin, "POST", UNSUBSCRIBE, { body: "List-Unsubscribe=One-Click" }),
      ).toMatchObject({ status: 200 });
      expect(calls).toEqual(["cont_1"]);
      // The route reads no body, so one without a Content-Length is never read at all: the
      // link is honoured, and the connection is closed on what was sent.
      expect(yield* chunked(origin, UNSUBSCRIBE, 2 * MIB)).toMatchObject({
        connection: "close",
        status: 200,
      });
    }),
  );

  it.live("refuses an over-size body to a dashboard route before its session is checked", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const post = { "content-type": "application/json", origin: APP_ORIGIN };

      expect(yield* announced(origin, "/projects", post)).toMatchObject({
        body: tooLarge(1),
        status: "HTTP/1.1 413 Payload Too Large",
      });
      // At the limit the route runs, and refuses a request with no session.
      expect(yield* announced(origin, "/projects", post, MIB)).toMatchObject({
        status: "HTTP/1.1 401 Unauthorized",
      });
      // Without a Content-Length the session comes first, and the body is never read.
      expect(yield* chunked(origin, "/projects", 2 * MIB)).toMatchObject({
        connection: "close",
        status: 401,
      });
    }),
  );

  it.live("gives an Email Workspace commit its own, larger limit", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const post = { "content-type": "application/json", origin: APP_ORIGIN };

      // The page is another origin: without CORS on the refusal, it sees a failed request.
      expect(yield* announced(origin, COMMITS, post)).toMatchObject({
        body: tooLarge(10),
        headers: {
          "access-control-allow-credentials": "true",
          "access-control-allow-origin": APP_ORIGIN,
          connection: "close",
        },
        status: "HTTP/1.1 413 Payload Too Large",
      });
      const elsewhere = yield* announced(origin, COMMITS, { ...post, origin: "http://evil.test" });
      expect(elsewhere.status).toBe("HTTP/1.1 413 Payload Too Large");
      expect(elsewhere.headers).not.toHaveProperty("access-control-allow-origin");
      // Over the default and within its own: the route runs, and asks for a session.
      expect(yield* announced(origin, COMMITS, post, 10 * MIB)).toMatchObject({
        status: "HTTP/1.1 401 Unauthorized",
      });
    }),
  );

  it.live("rejects the dashboard's client with the limit when a commit is over it", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const client = yield* HttpApiClient.make(DashboardApi, { baseUrl: origin });

      // The whole body is sent, as a browser sends it, and the refusal still arrives.
      const refused = yield* client.workspaces
        .createCommit({
          params: { kind: "reactEmail", orgSlug: "acme" },
          payload: { changes: { "reactEmail/big.tsx": "a".repeat(11 * MIB) } },
        })
        .pipe(Effect.flip);

      expect(refused).toMatchObject({
        _tag: "PayloadTooLarge",
        message: "Request body exceeds the 10 MiB limit.",
      });
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  it.live("refuses an over-size body to better-auth before it is handed the request", () =>
    Effect.gen(function* () {
      // The stubbed better-auth has no handler: reaching it would be a 500.
      const origin = yield* serve(stubs().stubs);

      for (const path of ["/auth/sign-in/email", "/auth/sign-up/email", "/auth/stripe/webhook"]) {
        expect(yield* announced(origin, path, {})).toMatchObject({
          body: tooLarge(1),
          status: "HTTP/1.1 413 Payload Too Large",
        });
        // Without a Content-Length, reading stops once it passes the limit.
        expect(yield* chunked(origin, path, 2 * MIB)).toEqual({
          body: tooLarge(1),
          connection: "close",
          contentType: JSON_TYPE,
          status: 413,
        });
      }
    }),
  );

  it.live("hands better-auth the bytes it was sent, as Stripe's signature needs", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({
          authHandler: async (request) =>
            new Response(await request.arrayBuffer(), {
              headers: { "x-signature": request.headers.get("stripe-signature") ?? "" },
            }),
        }).stubs,
      );
      // Not valid UTF-8, and JSON whose spacing a re-encode would change.
      const sent = new Uint8Array([
        ...new TextEncoder().encode('{ "id" :\t"evt_1",\r\n "n": 1.0,"é":"\u00e9" }'),
        0xff,
        0xfe,
        0x00,
      ]);
      const echoed = (body: Uint8Array | ReadableStream<Uint8Array>, duplex?: "half") =>
        Effect.promise(async () => {
          const response = await fetch(`${origin}/auth/stripe/webhook`, {
            body,
            duplex,
            headers: { "stripe-signature": "t=1,v1=abc" },
            method: "POST",
          });
          return {
            bytes: [...new Uint8Array(await response.arrayBuffer())],
            signature: response.headers.get("x-signature"),
          };
        });

      const expected = { bytes: [...sent], signature: "t=1,v1=abc" };
      expect(yield* echoed(sent)).toEqual(expected);
      expect(
        yield* echoed(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(sent.slice(0, 7));
              controller.enqueue(sent.slice(7));
              controller.close();
            },
          }),
          "half",
        ),
      ).toEqual(expected);
    }),
  );
});
