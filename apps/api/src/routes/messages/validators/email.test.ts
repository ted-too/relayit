import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { parseEmailFrom, refineSendEmailBody, SendEmailBody } from "./email";

const decode = Schema.decodeUnknownResult(SendEmailBody);

/** The body as the route sees it: the schema, then the checks across fields. */
const parseSendEmailBody = (input: unknown): Result.Result<SendEmailBody, unknown> => {
  const decoded = decode(input);
  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure);
  }
  const refused = refineSendEmailBody(decoded.success);
  return refused === undefined ? Result.succeed(decoded.success) : Result.fail(refused);
};

const parsed = (input: unknown) => {
  const result = parseSendEmailBody(input);
  if (Result.isFailure(result)) {
    throw new Error(`expected the body to parse: ${String(result.failure)}`);
  }
  return result.success;
};

describe("SendEmailBody", () => {
  it("accepts a minimal body and parses From", () => {
    const body = parsed({
      from: "Acme <noreply@example.com>",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    expect(body.from).toBe("Acme <noreply@example.com>");
    expect(parseEmailFrom(body.from)).toEqual({
      name: "Acme",
      address: "noreply@example.com",
      normalized: "Acme <noreply@example.com>",
    });
    expect(body.to).toEqual(["user@example.com"]);
  });

  it("accepts contact-object recipients and tags", () => {
    const body = parsed({
      from: "noreply@example.com",
      to: {
        email: "user@example.com",
        first_name: "Ada",
        properties: { plan: "pro" },
      },
      subject: "Hello",
      text: "Hi",
      tags: [{ name: "category", value: "welcome" }],
      attachments: [
        {
          filename: "invoice.pdf",
          path: "https://example.com/invoice.pdf",
        },
      ],
    });

    expect(body.to).toEqual({
      email: "user@example.com",
      first_name: "Ada",
      properties: { plan: "pro" },
    });
    expect(body.tags).toEqual([{ name: "category", value: "welcome" }]);
    expect(body.attachments?.[0]).toMatchObject({
      filename: "invoice.pdf",
      path: "https://example.com/invoice.pdf",
    });
  });

  // Resend's topic_id has no meaning here (Topics belong to Campaigns). The route has always
  // dropped it with any other unknown field rather than refused it; see #ISSUE.
  it("drops topic_id, as it drops any field it does not know", () => {
    const body = parsed({
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      topic_id: "topic_123",
    });

    expect(body).not.toHaveProperty("topic_id");
  });

  it("rejects inline content combined with template", () => {
    const result = parseSendEmailBody({
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      template: { id: "tmpl_123" },
    });

    expect(Result.isFailure(result)).toBe(true);
  });

  it("accepts a template ref without subject (subject comes from the Template)", () => {
    const body = parsed({
      from: "noreply@example.com",
      to: ["user@example.com"],
      template: {
        id: "welcome-email",
        variables: { PRODUCT: "Laptop", PRICE: 25 },
      },
    });

    expect(body.template?.id).toBe("welcome-email");
    expect(body.subject).toBeUndefined();
  });

  it("rejects inline html/text without subject", () => {
    const result = parseSendEmailBody({
      from: "noreply@example.com",
      to: ["user@example.com"],
      html: "<p>Hi</p>",
    });

    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects attachment with both content and path", () => {
    const result = parseSendEmailBody({
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      attachments: [
        {
          filename: "a.pdf",
          content: "YWJj",
          path: "https://example.com/a.pdf",
        },
      ],
    });

    expect(Result.isFailure(result)).toBe(true);
  });
});
