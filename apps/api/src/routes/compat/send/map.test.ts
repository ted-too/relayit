import { describe, expect, test } from "bun:test";
import {
  type AcceptedTransactionalEmail,
  EmailAcceptRejected,
} from "@repo/channels/email/accept";
import { UsageLimitExceeded } from "@repo/channels/usage";
import {
  mapAcceptResultToLegacyResponse,
  mapLegacyRawToAccept,
  mapLegacyTemplateToAccept,
  resolveLegacyDefaultFromAddress,
} from "./map";

describe("mapLegacyRawToAccept", () => {
  test("maps a raw payload and contact into Accept input", () => {
    const mapped = mapLegacyRawToAccept({
      body: {
        contact: {
          externalIdentifiers: { crm: "abc" },
          name: "Ada",
        },
        from: "sender@acme.test",
        payload: {
          html: "<p>Hello</p>",
          subject: "Hello",
        },
        to: "recipient@example.com",
      },
      organizationId: "org_1",
    });

    expect(mapped).toEqual({
      ok: true,
      input: {
        attribution: { kind: "project" },
        email: {
          attachments: [],
          bcc: [],
          cc: [],
          content: {
            html: "<p>Hello</p>",
            kind: "inline",
            subject: "Hello",
          },
          from: {
            address: "sender@acme.test",
            normalized: "sender@acme.test",
          },
          headers: {},
          replyTo: [],
          to: [
            {
              email: "recipient@example.com",
              firstName: "Ada",
              properties: { crm: "abc" },
            },
          ],
        },
        organizationId: "org_1",
      },
    });
  });

  test("maps camelCase attachments into Accept attachment sources", () => {
    const mapped = mapLegacyRawToAccept({
      body: {
        attachments: [
          {
            content: "aGVsbG8=",
            contentId: "cid_1",
            contentType: "text/plain",
            filename: "note.txt",
          },
          {
            filename: "logo.png",
            path: "https://cdn.example.com/logo.png",
          },
        ],
        from: "sender@acme.test",
        payload: { html: "<p>Hi</p>", subject: "Hi" },
        to: "recipient@example.com",
      },
      organizationId: "org_1",
    });

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }
    expect(mapped.input.email.attachments).toEqual([
      {
        contentId: "cid_1",
        contentType: "text/plain",
        filename: "note.txt",
        source: { content: "aGVsbG8=", kind: "base64" },
      },
      {
        filename: "logo.png",
        source: { kind: "url", url: "https://cdn.example.com/logo.png" },
      },
    ]);
  });

  test("keeps App and Environment only when both are present", () => {
    const paired = mapLegacyRawToAccept({
      body: {
        app: "web",
        appEnvironment: "production",
        from: "sender@acme.test",
        payload: { html: "<p>Hi</p>", subject: "Hi" },
        to: "recipient@example.com",
      },
      organizationId: "org_1",
    });
    const partial = mapLegacyRawToAccept({
      body: {
        app: "web",
        from: "sender@acme.test",
        payload: { html: "<p>Hi</p>", subject: "Hi" },
        to: "recipient@example.com",
      },
      organizationId: "org_1",
    });

    expect(paired.ok && paired.input.attribution).toEqual({
      app: "web",
      environment: "production",
      kind: "appEnvironment",
    });
    expect(partial.ok && partial.input.attribution).toEqual({
      kind: "project",
    });
  });

  test("rejects when from is omitted", () => {
    expect(
      mapLegacyRawToAccept({
        body: {
          payload: { html: "<p>Hi</p>", subject: "Hi" },
          to: "recipient@example.com",
        },
        organizationId: "org_1",
      })
    ).toEqual({
      details: [],
      message:
        "No sender identity available; pass from or provision Sandbox Domain",
      ok: false,
      status: 400,
    });
  });
});

describe("mapLegacyTemplateToAccept", () => {
  test("maps template slug and props into Accept input", () => {
    const mapped = mapLegacyTemplateToAccept({
      body: {
        from: "sender@acme.test",
        template: {
          props: { name: "Ada" },
          slug: "welcome",
        },
        to: "recipient@example.com",
      },
      organizationId: "org_1",
    });

    expect(mapped).toEqual({
      ok: true,
      input: {
        attribution: { kind: "project" },
        email: {
          attachments: [],
          bcc: [],
          cc: [],
          content: {
            idOrSlug: "welcome",
            kind: "template",
            values: { name: "Ada" },
          },
          from: {
            address: "sender@acme.test",
            normalized: "sender@acme.test",
          },
          headers: {},
          replyTo: [],
          to: [{ email: "recipient@example.com" }],
        },
        organizationId: "org_1",
      },
    });
  });
});

describe("resolveLegacyDefaultFromAddress", () => {
  test("returns sandbox@root when the Project sandbox is verified and active", async () => {
    const db = {
      query: {
        organization: {
          findFirst: async () => ({
            sandboxDomain: {
              isActive: true,
              isPaused: false,
              rootDomain: "relayit.test",
              verificationStatus: "verified",
            },
          }),
        },
      },
    };

    expect(
      await resolveLegacyDefaultFromAddress({
        db: db as never,
        organizationId: "org_1",
      })
    ).toBe("sandbox@relayit.test");
  });

  test("returns null when sandbox is missing or not sendable", async () => {
    const db = {
      query: {
        organization: {
          findFirst: async () => ({
            sandboxDomain: {
              isActive: true,
              isPaused: true,
              rootDomain: "relayit.test",
              verificationStatus: "verified",
            },
          }),
        },
      },
    };

    expect(
      await resolveLegacyDefaultFromAddress({
        db: db as never,
        organizationId: "org_1",
      })
    ).toBeNull();
  });
});

describe("mapAcceptResultToLegacyResponse", () => {
  test("returns queued for an accepted message", () => {
    expect(
      mapAcceptResultToLegacyResponse({
        deliveryId: "edlv_1",
        messageId: "msg_1",
        replayed: false,
        stripped: [],
      } satisfies AcceptedTransactionalEmail)
    ).toEqual({
      body: { id: "msg_1", status: "queued" },
      status: 201,
    });
  });

  test("maps EmailAcceptRejected to the legacy error envelope", () => {
    expect(
      mapAcceptResultToLegacyResponse(
        new EmailAcceptRejected({
          code: "template_not_found",
          message: "Template not found.",
        })
      )
    ).toEqual({
      body: { details: ["template_not_found"], message: "Template not found." },
      status: 400,
    });
  });

  test("maps UsageLimitExceeded to 429", () => {
    expect(
      mapAcceptResultToLegacyResponse(
        new UsageLimitExceeded({
          deliveryId: "edlv_1",
          providerKind: "managed",
          retryAt: new Date("2026-08-15T00:00:00.000Z"),
          window: "daily",
        })
      )
    ).toEqual({
      body: {
        details: ["daily_limit_exceeded"],
        message: "Daily email send limit exceeded",
      },
      status: 429,
    });
  });
});
