import { describe, expect, test } from "@effect/vitest";
import {
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
      }),
    ).toEqual({
      details: [],
      message: "No sender identity available; pass from or provision Sandbox Domain",
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
  const noLinkedDomain = { findFirst: async () => undefined };

  test("returns noreply@domain when the Project has a sendable custom Domain", async () => {
    const db = {
      query: {
        organization: {
          findFirst: () => Promise.reject(new Error("sandbox should not be consulted")),
        },
        organizationDomain: {
          findFirst: async () => ({
            customDomain: { fqdn: "acme.test" },
            customDomainId: "domn_1",
          }),
        },
      },
    };

    expect(
      await resolveLegacyDefaultFromAddress({
        db: db as never,
        organizationId: "org_1",
      }),
    ).toBe("noreply@acme.test");
  });

  test("returns sandbox@root when the Project sandbox is verified and active", async () => {
    const db = {
      query: {
        organizationDomain: noLinkedDomain,
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
      }),
    ).toBe("sandbox@relayit.test");
  });

  test("returns null when sandbox is missing or not sendable", async () => {
    const db = {
      query: {
        organizationDomain: noLinkedDomain,
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
      }),
    ).toBeNull();
  });
});
