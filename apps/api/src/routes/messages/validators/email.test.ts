import { describe, expect, it } from "bun:test";
import { sendEmailBodySchema } from "./email";

describe("sendEmailBodySchema (Resend-compatible)", () => {
  it("accepts a minimal Resend-shaped body and parses From", () => {
    const parsed = sendEmailBodySchema.parse({
      from: "Acme <noreply@example.com>",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    expect(parsed.from).toEqual({
      name: "Acme",
      address: "noreply@example.com",
      normalized: "Acme <noreply@example.com>",
    });
    expect(parsed.to).toEqual([{ email: "user@example.com" }]);
  });

  it("accepts Relayit contact-object recipients and Resend tags", () => {
    const parsed = sendEmailBodySchema.parse({
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

    expect(parsed.to[0]?.first_name).toBe("Ada");
    expect(parsed.tags).toEqual({ category: "welcome" });
    expect(parsed.attachments?.[0]).toMatchObject({
      filename: "invoice.pdf",
      path: "https://example.com/invoice.pdf",
    });
  });

  it("rejects topic_id on the transactional facade", () => {
    const result = sendEmailBodySchema.safeParse({
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      topic_id: "topic_123",
    });

    expect(result.success).toBe(false);
  });

  it("rejects inline content combined with template", () => {
    const result = sendEmailBodySchema.safeParse({
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      template: { id: "tmpl_123" },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a template ref without subject (subject comes from the Template)", () => {
    const parsed = sendEmailBodySchema.parse({
      from: "noreply@example.com",
      to: ["user@example.com"],
      template: {
        id: "welcome-email",
        variables: { PRODUCT: "Laptop", PRICE: 25 },
      },
    });

    expect(parsed.template?.id).toBe("welcome-email");
    expect(parsed.subject).toBeUndefined();
  });

  it("rejects inline html/text without subject", () => {
    const result = sendEmailBodySchema.safeParse({
      from: "noreply@example.com",
      to: ["user@example.com"],
      html: "<p>Hi</p>",
    });

    expect(result.success).toBe(false);
  });

  it("rejects attachment with both content and path", () => {
    const result = sendEmailBodySchema.safeParse({
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

    expect(result.success).toBe(false);
  });
});
