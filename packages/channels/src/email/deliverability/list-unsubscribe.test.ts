import { describe, expect, it, test } from "@effect/vitest";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import {
  buildListUnsubscribeHeaders,
  buildListUnsubscribeUrl,
  handleListUnsubscribeOneClick,
  ListUnsubscribeError,
  mergeListUnsubscribeHeadersForSend,
  signListUnsubscribe,
  verifyListUnsubscribe,
} from "./list-unsubscribe";

const SECRET = "test-unsubscribe-secret";

describe("list-unsubscribe tokens", () => {
  test("signs and verifies contactId:messageId:topicId", () => {
    const signature = signListUnsubscribe({
      contactId: "cont_1",
      messageId: "msg_1",
      secret: SECRET,
      topicId: "topc_1",
    });

    expect(
      verifyListUnsubscribe({
        contactId: "cont_1",
        messageId: "msg_1",
        secrets: [SECRET],
        signature,
        topicId: "topc_1",
      }),
    ).toBe(true);
  });

  test("rejects tampered topicId", () => {
    const signature = signListUnsubscribe({
      contactId: "cont_1",
      messageId: "msg_1",
      secret: SECRET,
      topicId: "topc_1",
    });

    expect(
      verifyListUnsubscribe({
        contactId: "cont_1",
        messageId: "msg_1",
        secrets: [SECRET],
        signature,
        topicId: "topc_other",
      }),
    ).toBe(false);
  });

  test("verifies a link signed with any secret, so one survives a rotation", () => {
    const signedBeforeRotation = signListUnsubscribe({
      contactId: "cont_1",
      messageId: "msg_1",
      secret: "old-secret",
      topicId: "topc_1",
    });
    const link = { contactId: "cont_1", messageId: "msg_1", topicId: "topc_1" };

    expect(
      verifyListUnsubscribe({
        ...link,
        secrets: ["new-secret", "old-secret"],
        signature: signedBeforeRotation,
      }),
    ).toBe(true);
    expect(
      verifyListUnsubscribe({ ...link, secrets: ["new-secret"], signature: signedBeforeRotation }),
    ).toBe(false);
  });

  test("builds List-Unsubscribe URL and RFC 8058 headers", () => {
    const url = buildListUnsubscribeUrl({
      contactId: "cont_1",
      messageId: "msg_1",
      orgSlug: "acme",
      secret: SECRET,
      topicId: "topc_1",
      apiOrigin: "https://api.example.com",
    });

    expect(url.startsWith("https://api.example.com/unsubscribe/acme/cont_1?")).toBe(true);
    expect(url).toContain("msg=msg_1");
    expect(url).toContain("topic=topc_1");
    expect(url).toContain("sig=");

    expect(buildListUnsubscribeHeaders({ httpsUrl: url })).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  test("merges headers only for single-recipient marketing sends", () => {
    const merged = mergeListUnsubscribeHeadersForSend({
      bccCount: 0,
      ccCount: 0,
      contactId: "cont_1",
      existing: { "X-Custom": "1" },
      messageId: "msg_1",
      orgSlug: "acme",
      purpose: "marketing",
      secret: SECRET,
      toCount: 1,
      topicId: "topc_1",
      apiOrigin: "https://api.example.com",
    });

    expect(merged).toEqual(
      expect.objectContaining({
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Custom": "1",
      }),
    );
    expect(merged?.["List-Unsubscribe"]).toContain(
      "https://api.example.com/unsubscribe/acme/cont_1?",
    );

    expect(
      mergeListUnsubscribeHeadersForSend({
        bccCount: 0,
        ccCount: 0,
        contactId: "cont_1",
        existing: { "X-Custom": "1" },
        messageId: "msg_1",
        orgSlug: "acme",
        purpose: "transactional",
        secret: SECRET,
        toCount: 1,
        topicId: "topc_1",
        apiOrigin: "https://api.example.com",
      }),
    ).toEqual({ "X-Custom": "1" });
  });
});

describe("handleListUnsubscribeOneClick", () => {
  it.effect("rejects an invalid signature before reading anything", () =>
    Effect.gen(function* () {
      const error = yield* handleListUnsubscribeOneClick({
        contactId: "cont_1",
        messageId: "msg_1",
        secrets: [SECRET],
        signature: "bad",
        topicId: "topc_1",
      }).pipe(Effect.provide(Layer.succeed(DB, {} as never)), Effect.flip);

      expect(error).toBeInstanceOf(ListUnsubscribeError);
      expect(error.code).toBe("invalid_signature");
    }),
  );
});
