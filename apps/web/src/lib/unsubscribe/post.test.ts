import { describe, expect, it } from "@effect/vitest";
import {
  type handleListUnsubscribeOneClick,
  ListUnsubscribeError,
} from "@repo/channels/email/deliverability";
import { Effect, FiberSet } from "effect";
import { createUnsubscribePostHandler } from "./post.server";

const postUnsubscribe = (handle: typeof handleListUnsubscribeOneClick, path: string) =>
  Effect.gen(function* () {
    const post = createUnsubscribePostHandler(handle, {
      runEffect: yield* FiberSet.makeRuntimePromise(),
      secret: "test-secret",
    });
    const response = yield* Effect.promise(() =>
      post({
        params: { contactId: "cont_1", orgSlug: "acme" },
        request: new Request(`http://localhost${path}`, {
          body: "List-Unsubscribe=One-Click",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        }),
      }),
    );
    const body: unknown = yield* Effect.promise(() => response.json());
    return { body, status: response.status };
  });

describe("POST /unsubscribe/$orgSlug/$contactId", () => {
  it.effect("returns 400 when query params are missing", () =>
    Effect.gen(function* () {
      const { body, status } = yield* postUnsubscribe(
        () => Effect.die("unused"),
        "/unsubscribe/acme/cont_1",
      );

      expect(status).toBe(400);
      expect(body).toEqual({
        code: "bad_request",
        message: "msg, topic, and sig query params are required",
      });
    }),
  );

  it.effect("returns 400 when the handler reports invalid signature", () =>
    Effect.gen(function* () {
      const { body, status } = yield* postUnsubscribe(
        () =>
          Effect.fail(
            new ListUnsubscribeError({
              code: "invalid_signature",
              message: "Invalid unsubscribe signature",
            }),
          ),
        "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=bad",
      );

      expect(status).toBe(400);
      expect(body).toEqual({
        code: "invalid_signature",
        message: "Invalid unsubscribe signature",
      });
    }),
  );

  it.effect("returns 404 when the handler reports not found", () =>
    Effect.gen(function* () {
      const { body, status } = yield* postUnsubscribe(
        () =>
          Effect.fail(
            new ListUnsubscribeError({
              code: "not_found",
              message: "Contact not found",
            }),
          ),
        "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=sig",
      );

      expect(status).toBe(404);
      expect(body).toEqual({
        code: "not_found",
        message: "Contact not found",
      });
    }),
  );

  it.effect("returns 200 when the handler accepts the unsubscribe", () =>
    Effect.gen(function* () {
      const captured: {
        contactId: string;
        messageId: string;
        orgSlug: string;
        signature: string;
        topicId: string;
      }[] = [];

      const { body, status } = yield* postUnsubscribe((input) => {
        captured.push({
          contactId: input.contactId,
          messageId: input.messageId,
          orgSlug: input.orgSlug,
          signature: input.signature,
          topicId: input.topicId,
        });
        return Effect.succeed({
          contactId: "cont_1",
          ok: true as const,
          topicId: "topc_1",
        });
      }, "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=sig_1");

      expect(status).toBe(200);
      expect(body).toEqual({
        contactId: "cont_1",
        ok: true,
        topicId: "topc_1",
      });
      expect(captured).toEqual([
        {
          contactId: "cont_1",
          messageId: "msg_1",
          orgSlug: "acme",
          signature: "sig_1",
          topicId: "topc_1",
        },
      ]);
    }),
  );
});
