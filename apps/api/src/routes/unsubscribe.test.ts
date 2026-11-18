import { describe, expect, it } from "@effect/vitest";
import { ListUnsubscribeError } from "@repo/channels/email/deliverability";
import { Effect } from "effect";
import { request, serve, stubs } from "../testing";

/** As a mailbox provider sends it (RFC 8058): no cookie, a form body. */
const oneClick = (origin: string, path: string) =>
  request(origin, "POST", path, {
    body: "List-Unsubscribe=One-Click",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

const JSON_TYPE = "application/json;charset=utf-8";

describe("POST /unsubscribe/:orgSlug/:contactId", () => {
  it.live("refuses a link without its query with 400", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs({ unsubscribe: () => Effect.die("unused") }).stubs);
      expect(yield* oneClick(origin, "/unsubscribe/acme/cont_1")).toEqual({
        body: JSON.stringify({
          code: "bad_request",
          message: "msg, topic, and sig query params are required",
        }),
        contentType: JSON_TYPE,
        status: 400,
      });
    }),
  );

  it.live("answers 400 for a bad signature and 404 for an unknown Contact", () =>
    Effect.gen(function* () {
      const invalid = yield* serve(
        stubs({
          unsubscribe: () =>
            Effect.fail(
              new ListUnsubscribeError({
                code: "invalid_signature",
                message: "Invalid unsubscribe signature",
              }),
            ),
        }).stubs,
      );
      expect(
        yield* oneClick(invalid, "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=bad"),
      ).toEqual({
        body: JSON.stringify({
          code: "invalid_signature",
          message: "Invalid unsubscribe signature",
        }),
        contentType: JSON_TYPE,
        status: 400,
      });

      const missing = yield* serve(
        stubs({
          unsubscribe: () =>
            Effect.fail(
              new ListUnsubscribeError({ code: "not_found", message: "Contact not found" }),
            ),
        }).stubs,
      );
      expect(
        yield* oneClick(missing, "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=sig"),
      ).toEqual({
        body: JSON.stringify({ code: "not_found", message: "Contact not found" }),
        contentType: JSON_TYPE,
        status: 404,
      });
    }),
  );

  it.live("unsubscribes with the link's parts and the current secret", () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const origin = yield* serve(
        stubs({
          unsubscribe: (input) => {
            calls.push(input);
            return Effect.succeed({ contactId: "cont_1", ok: true as const, topicId: "topc_1" });
          },
        }).stubs,
      );
      expect(
        yield* oneClick(origin, "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=sig_1"),
      ).toEqual({
        body: JSON.stringify({ contactId: "cont_1", ok: true, topicId: "topc_1" }),
        contentType: JSON_TYPE,
        status: 200,
      });
      expect(calls).toEqual([
        {
          contactId: "cont_1",
          messageId: "msg_1",
          orgSlug: "acme",
          secret: "test-secret",
          signature: "sig_1",
          topicId: "topc_1",
        },
      ]);
    }),
  );
});
