import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { GOOD_KEY, request, serve, stubs } from "../../testing";

const headers = { "content-type": "application/json", "x-api-key": GOOD_KEY };

describe("POST /messages/email", () => {
  it.live("maps a valid request to accept input", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);

      const response = yield* request(origin, "POST", "/messages/email", {
        body: JSON.stringify({
          from: "sender@example.com",
          html: "<p>Hello</p>",
          subject: "Hello",
          to: "recipient@example.com",
        }),
        headers,
      });

      expect(response.status).toBe(201);
      expect(accepted).toEqual([
        expect.objectContaining({
          attribution: { kind: "project" },
          email: expect.objectContaining({
            attachments: [],
            bcc: [],
            cc: [],
            content: expect.objectContaining({
              html: "<p>Hello</p>",
              kind: "inline",
              subject: "Hello",
            }),
            from: { address: "sender@example.com", normalized: "sender@example.com" },
            headers: {},
            replyTo: [],
            to: [expect.objectContaining({ email: "recipient@example.com" })],
          }),
          organizationId: "org_1",
        }),
      ]);
    }),
  );

  it.live("maps template wire fields, contacts, attachments and the App headers", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);

      const response = yield* request(origin, "POST", "/messages/email", {
        body: JSON.stringify({
          attachments: [
            { content: "SGk=", content_id: "logo", content_type: "image/png", filename: "a.png" },
            { filename: "b.pdf", path: "https://files.test/b.pdf" },
          ],
          bcc: [{ email: "bcc@example.com", last_name: "Lovelace" }],
          cc: ["cc@example.com"],
          from: "sender@example.com",
          headers: { "X-Campaign": "spring" },
          reply_to: ["support@example.com"],
          scheduled_at: "2030-01-01T09:00:00Z",
          subject: "Welcome",
          tags: [{ name: "kind", value: "welcome" }],
          template: { id: "welcome", variables: { name: "Ada" } },
          to: { email: "recipient@example.com", first_name: "Ada", properties: { plan: "pro" } },
        }),
        headers: {
          ...headers,
          app: "web",
          environment: "production",
          "idempotency-key": "idem_test",
        },
      });

      expect(response.status).toBe(201);
      expect(accepted[0]).toMatchObject({
        attribution: { app: "web", environment: "production", kind: "appEnvironment" },
        email: {
          attachments: [
            {
              contentId: "logo",
              contentType: "image/png",
              filename: "a.png",
              source: { content: "SGk=", kind: "base64" },
            },
            { filename: "b.pdf", source: { kind: "url", url: "https://files.test/b.pdf" } },
          ],
          bcc: [{ email: "bcc@example.com", lastName: "Lovelace" }],
          cc: [{ email: "cc@example.com" }],
          content: {
            idOrSlug: "welcome",
            kind: "template",
            subjectOverride: "Welcome",
            values: { name: "Ada" },
          },
          headers: { "X-Campaign": "spring" },
          replyTo: ["support@example.com"],
          to: [{ email: "recipient@example.com", firstName: "Ada", properties: { plan: "pro" } }],
        },
        idempotencyKey: "idem_test",
        organizationId: "org_1",
        tags: { kind: "welcome" },
      });
      expect(accepted[0]?.scheduledAt?.toString()).toContain("2030-01-01T09:00:00");
    }),
  );
});
