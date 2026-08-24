import { describe, expect, it } from "bun:test";
import { getSchemaValidator, t } from "elysia";
import {
  parseEmailFrom,
  refineSendEmailBody,
  type SendEmailBody,
  sendEmailBodySchema,
  sendEmailOpenApiModels,
} from "./email";

const validator = getSchemaValidator(
  t
    .Module({
      "#/components/schemas/Attachment": sendEmailOpenApiModels.Attachment,
      "#/components/schemas/Contact": sendEmailOpenApiModels.Contact,
      "#/components/schemas/EmailAddressList":
        sendEmailOpenApiModels.EmailAddressList,
      "#/components/schemas/Recipient": sendEmailOpenApiModels.Recipient,
      SendEmailBody: sendEmailBodySchema,
    })
    .Import("SendEmailBody")
);

if (!validator) {
  throw new Error("send email body validator failed to compile");
}

const parseSendEmailBody = (input: unknown): SendEmailBody => {
  const parsed = validator.parse(input) as SendEmailBody;
  const refinement = refineSendEmailBody(parsed);
  if (refinement !== undefined) {
    throw new Error(refinement);
  }
  return parsed;
};

const safeParseSendEmailBody = (input: unknown) => {
  const parsed = validator.safeParse(input);
  if (!parsed.success) {
    return parsed;
  }
  const refinement = refineSendEmailBody(parsed.data as SendEmailBody);
  if (refinement !== undefined) {
    return { data: null, error: refinement, success: false as const };
  }
  return parsed;
};

describe("sendEmailBodySchema", () => {
  it("accepts a minimal body and parses From", () => {
    const parsed = parseSendEmailBody({
      from: "Acme <noreply@example.com>",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    expect(parsed.from).toBe("Acme <noreply@example.com>");
    expect(parseEmailFrom(parsed.from)).toEqual({
      name: "Acme",
      address: "noreply@example.com",
      normalized: "Acme <noreply@example.com>",
    });
    expect(parsed.to).toEqual(["user@example.com"]);
  });

  it("accepts contact-object recipients and tags", () => {
    const parsed = parseSendEmailBody({
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

    expect(parsed.to).toEqual({
      email: "user@example.com",
      first_name: "Ada",
      properties: { plan: "pro" },
    });
    expect(parsed.tags).toEqual([{ name: "category", value: "welcome" }]);
    expect(parsed.attachments?.[0]).toMatchObject({
      filename: "invoice.pdf",
      path: "https://example.com/invoice.pdf",
    });
  });

  it("rejects topic_id on the transactional facade", () => {
    const result = safeParseSendEmailBody({
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      topic_id: "topic_123",
    });

    expect(result.success).toBe(false);
  });

  it("rejects inline content combined with template", () => {
    const result = safeParseSendEmailBody({
      from: "noreply@example.com",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      template: { id: "tmpl_123" },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a template ref without subject (subject comes from the Template)", () => {
    const parsed = parseSendEmailBody({
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
    const result = safeParseSendEmailBody({
      from: "noreply@example.com",
      to: ["user@example.com"],
      html: "<p>Hi</p>",
    });

    expect(result.success).toBe(false);
  });

  it("rejects attachment with both content and path", () => {
    const result = safeParseSendEmailBody({
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
