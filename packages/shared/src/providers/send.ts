import z from "zod";
import type { ChannelType } from "./base";

/** Max total attachment size after decode/fetch (Resend ballpark). */
export const MAX_ATTACHMENTS_BYTES = 40 * 1024 * 1024;
export const MAX_ATTACHMENTS_COUNT = 20;

export const recipientSchema = z
  .object({
    name: z
      .string()
      .optional()
      .describe("Display name for the contact")
      .meta({ example: "John Doe" }),
    externalIdentifiers: z
      .record(z.string(), z.string())
      .optional()
      .describe("External system identifiers for contact linking")
      .meta({ example: { user_id: "12345", customer_id: "cust_789" } }),
  })
  .describe("Contact information for recipient");

export type Recipient = z.infer<typeof recipientSchema>;

// Channel-specific identifier validation
export const channelIdentifierValidators = {
  email: z
    .email()
    .describe("Valid email address")
    .meta({ example: "user@example.com" }),
  // Future channels can be added here:
  // sms: z.string().regex(/^\+[1-9]\d{1,14}$/, "Invalid phone number (E.164 format)"),
  // whatsapp: z.string().regex(/^\+[1-9]\d{1,14}$/, "Invalid WhatsApp number (E.164 format)"),
  // discord: z.string().regex(/^\d{17,19}$/, "Invalid Discord user ID"),
} satisfies Partial<Record<ChannelType, z.ZodType>>;

/** Client-facing attachment input (Resend-compatible, camelCase). */
export const attachmentInputSchema = z
  .object({
    content: z
      .string()
      .optional()
      .describe("Base64-encoded file content")
      .meta({ example: "SGVsbG8gV29ybGQ=" }),
    path: z
      .url()
      .optional()
      .describe("Public URL to fetch the attachment from")
      .meta({ example: "https://example.com/files/invoice.pdf" }),
    filename: z
      .string()
      .min(1)
      .describe("Attachment filename")
      .meta({ example: "invoice.pdf" }),
    contentType: z
      .string()
      .optional()
      .describe("MIME type (derived from filename if omitted)")
      .meta({ example: "application/pdf" }),
    contentId: z
      .string()
      .optional()
      .describe("Content-ID for inline images (use with cid: in HTML)")
      .meta({ example: "logo" }),
  })
  .refine(
    (data) =>
      Number(data.content !== undefined) + Number(data.path !== undefined) ===
      1,
    {
      message: "Exactly one of 'content' or 'path' must be provided",
      path: ["content"],
    }
  )
  .describe("Email attachment");

export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

/** Persisted attachment metadata (bytes live in object storage). */
export const storedAttachmentSchema = z
  .object({
    storageKey: z.string().describe("Object storage key"),
    filename: z.string().describe("Attachment filename"),
    contentType: z.string().describe("MIME type"),
    contentId: z.string().optional().describe("Content-ID for inline images"),
    size: z.number().int().nonnegative().describe("Size in bytes"),
  })
  .describe("Stored attachment metadata");

export type StoredAttachment = z.infer<typeof storedAttachmentSchema>;

export const attachmentsInputSchema = z
  .array(attachmentInputSchema)
  .max(MAX_ATTACHMENTS_COUNT)
  .optional()
  .describe("Optional email attachments (max 20, 40MB total)");

export const sendRawPayloadSchemas = {
  email: z
    .object({
      subject: z
        .string()
        .describe("Email subject line")
        .meta({ example: "Welcome to our service!" }),
      html: z
        .string()
        .optional()
        .describe("HTML email content")
        .meta({ example: "<h1>Welcome!</h1><p>Thanks for joining us.</p>" }),
      text: z
        .string()
        .optional()
        .describe("Plain text email content")
        .meta({ example: "Welcome! Thanks for joining us." }),
      attachments: z
        .array(storedAttachmentSchema)
        .optional()
        .describe("Stored attachment metadata for delivery"),
    })
    .refine((data) => data.html !== undefined || data.text !== undefined, {
      message: "At least one of 'html' or 'text' must be provided",
      path: ["html", "text"],
    })
    .describe("Email payload content"),
} satisfies Record<ChannelType, z.ZodObject>;

export type SendRawPayload<T extends ChannelType = ChannelType> = z.infer<
  (typeof sendRawPayloadSchemas)[T]
>;

/** Request payload for raw send — content only; attachments are top-level. */
export const sendRawRequestPayloadSchemas = {
  email: z
    .object({
      subject: z
        .string()
        .describe("Email subject line")
        .meta({ example: "Welcome to our service!" }),
      html: z
        .string()
        .optional()
        .describe("HTML email content")
        .meta({ example: "<h1>Welcome!</h1><p>Thanks for joining us.</p>" }),
      text: z
        .string()
        .optional()
        .describe("Plain text email content")
        .meta({ example: "Welcome! Thanks for joining us." }),
    })
    .refine((data) => data.html !== undefined || data.text !== undefined, {
      message: "At least one of 'html' or 'text' must be provided",
      path: ["html", "text"],
    })
    .describe("Email payload content"),
} satisfies Record<ChannelType, z.ZodObject>;

const buildBaseSendSchema = (channel: ChannelType) =>
  z.object({
    to: channelIdentifierValidators[channel].describe("Recipient address"),
    from: channelIdentifierValidators[channel]
      .optional()
      .describe("Sender identity (uses default if not specified)")
      .meta({ example: "noreply@company.com" }),
    contact: recipientSchema.optional(),
    app: z
      .string()
      .optional()
      .describe("Application identifier for message tagging")
      .meta({ example: "mobile-app" }),
    appEnvironment: z
      .string()
      .optional()
      .describe("Application environment for message tagging")
      .meta({ example: "production" }),
    attachments: attachmentsInputSchema,
  });

export const buildSendRawSchema = (channel: ChannelType) =>
  buildBaseSendSchema(channel)
    .extend(
      z.object({
        payload: sendRawRequestPayloadSchemas[channel],
      }).shape
    )
    .describe("Send raw email content");

export const buildSendTemplateSchema = (channel: ChannelType) =>
  buildBaseSendSchema(channel)
    .extend(
      z.object({
        template: z
          .object({
            slug: z
              .string()
              .describe("Template identifier")
              .meta({ example: "user.welcome" }),
            props: z
              .any()
              .optional()
              .describe(
                "Template variables and data - can be any JSON value including complex objects"
              )
              .meta({
                example: {
                  firstName: "John",
                  companyName: "Acme Inc",
                  verificationUrl: "https://app.example.com/verify/abc123",
                  complexData: {
                    nested: {
                      values: [1, 2, 3],
                      enabled: true,
                    },
                  },
                },
              }),
          })
          .describe("Template configuration"),
      }).shape
    )
    .describe("Send email using template");
