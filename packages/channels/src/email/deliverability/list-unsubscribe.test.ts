import { describe, expect, test } from "bun:test";
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
        secret: SECRET,
        signature,
        topicId: "topc_1",
      })
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
        secret: SECRET,
        signature,
        topicId: "topc_other",
      })
    ).toBe(false);
  });

  test("builds List-Unsubscribe URL and RFC 8058 headers", () => {
    const url = buildListUnsubscribeUrl({
      contactId: "cont_1",
      messageId: "msg_1",
      orgSlug: "acme",
      secret: SECRET,
      topicId: "topc_1",
      webOrigin: "https://app.example.com",
    });

    expect(url).toStartWith("https://app.example.com/unsubscribe/acme/cont_1?");
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
      webOrigin: "https://app.example.com",
    });

    expect(merged).toEqual(
      expect.objectContaining({
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Custom": "1",
      })
    );
    expect(merged?.["List-Unsubscribe"]).toContain(
      "https://app.example.com/unsubscribe/acme/cont_1?"
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
        webOrigin: "https://app.example.com",
      })
    ).toEqual({ "X-Custom": "1" });
  });
});

describe("handleListUnsubscribeOneClick", () => {
  test("inserts a per-topic unsubscribe for a marketing message", async () => {
    const inserts: unknown[] = [];
    const db: any = {
      insert: () => ({
        values: (values: unknown) => ({
          onConflictDoNothing: () => {
            inserts.push(values);
            return Effect.void;
          },
        }),
      }),
      query: {
        contact: {
          findFirst: () =>
            Effect.succeed({
              appEnvironment: { organizationId: "org_1" },
              deletedAt: null,
              id: "cont_1",
            }),
        },
        message: {
          findFirst: () =>
            Effect.succeed({
              appEnvironment: { organizationId: "org_1" },
              id: "msg_1",
              purpose: "marketing",
            }),
        },
        organization: {
          findFirst: () => Effect.succeed({ id: "org_1", slug: "acme" }),
        },
        topic: {
          findFirst: () =>
            Effect.succeed({
              id: "topc_1",
              organizationId: "org_1",
            }),
        },
      },
    };

    const signature = signListUnsubscribe({
      contactId: "cont_1",
      messageId: "msg_1",
      secret: SECRET,
      topicId: "topc_1",
    });

    const result = await Effect.runPromise(
      handleListUnsubscribeOneClick({
        contactId: "cont_1",
        messageId: "msg_1",
        orgSlug: "acme",
        secret: SECRET,
        signature,
        topicId: "topc_1",
      }).pipe(Effect.provide(Layer.succeed(DB, db)))
    );

    expect(result).toEqual({
      contactId: "cont_1",
      ok: true,
      topicId: "topc_1",
    });
    expect(inserts).toEqual([
      {
        contactId: "cont_1",
        topicId: "topc_1",
      },
    ]);
  });

  test("rejects an invalid signature", async () => {
    const error = await Effect.runPromise(
      handleListUnsubscribeOneClick({
        contactId: "cont_1",
        messageId: "msg_1",
        orgSlug: "acme",
        secret: SECRET,
        signature: "bad",
        topicId: "topc_1",
      }).pipe(Effect.provide(Layer.succeed(DB, {} as never)), Effect.flip)
    );

    expect(error).toBeInstanceOf(ListUnsubscribeError);
    expect(error.code).toBe("invalid_signature");
  });

  test("rejects transactional messages", async () => {
    const signature = signListUnsubscribe({
      contactId: "cont_1",
      messageId: "msg_1",
      secret: SECRET,
      topicId: "topc_1",
    });

    const db: any = {
      query: {
        contact: {
          findFirst: () =>
            Effect.succeed({
              appEnvironment: { organizationId: "org_1" },
              deletedAt: null,
              id: "cont_1",
            }),
        },
        message: {
          findFirst: () =>
            Effect.succeed({
              appEnvironment: { organizationId: "org_1" },
              id: "msg_1",
              purpose: "transactional",
            }),
        },
        organization: {
          findFirst: () => Effect.succeed({ id: "org_1", slug: "acme" }),
        },
        topic: {
          findFirst: () =>
            Effect.succeed({
              id: "topc_1",
              organizationId: "org_1",
            }),
        },
      },
    };

    const error = await Effect.runPromise(
      handleListUnsubscribeOneClick({
        contactId: "cont_1",
        messageId: "msg_1",
        orgSlug: "acme",
        secret: SECRET,
        signature,
        topicId: "topc_1",
      }).pipe(Effect.provide(Layer.succeed(DB, db)), Effect.flip)
    );

    expect(error.code).toBe("bad_request");
  });
});
