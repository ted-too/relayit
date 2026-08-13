import { describe, expect, test } from "bun:test";
import {
  type handleListUnsubscribeOneClick,
  ListUnsubscribeError,
} from "@repo/channels/email/deliverability";
import { Effect } from "effect";
import { createUnsubscribePostHandler } from "./post";

const postUnsubscribe = (
  handle: typeof handleListUnsubscribeOneClick,
  path: string
): Promise<Response> => {
  const post = createUnsubscribePostHandler(handle, {
    runEffect: (effect) => Effect.runPromise(effect),
    secret: "test-secret",
  });
  return post({
    params: { contactId: "cont_1", orgSlug: "acme" },
    request: new Request(`http://localhost${path}`, {
      body: "List-Unsubscribe=One-Click",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
  });
};

describe("POST /unsubscribe/$orgSlug/$contactId", () => {
  test("returns 400 when query params are missing", async () => {
    const response = await postUnsubscribe(
      () => Effect.die("unused"),
      "/unsubscribe/acme/cont_1"
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: "bad_request",
      message: "msg, topic, and sig query params are required",
    });
  });

  test("returns 400 when the handler reports invalid signature", async () => {
    const response = await postUnsubscribe(
      () =>
        Effect.fail(
          new ListUnsubscribeError({
            code: "invalid_signature",
            message: "Invalid unsubscribe signature",
          })
        ),
      "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=bad"
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      code: "invalid_signature",
      message: "Invalid unsubscribe signature",
    });
  });

  test("returns 404 when the handler reports not found", async () => {
    const response = await postUnsubscribe(
      () =>
        Effect.fail(
          new ListUnsubscribeError({
            code: "not_found",
            message: "Contact not found",
          })
        ),
      "/unsubscribe/acme/cont_1?msg=msg_1&topic=topc_1&sig=sig"
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      code: "not_found",
      message: "Contact not found",
    });
  });

  test("returns 200 when the handler accepts the unsubscribe", async () => {
    const captured: {
      contactId: string;
      messageId: string;
      orgSlug: string;
      signature: string;
      topicId: string;
    }[] = [];

    const response = await postUnsubscribe((input) => {
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
    const body = await response.json();

    expect(response.status).toBe(200);
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
  });
});
