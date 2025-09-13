import z from "zod";
import type { ChannelType } from "./base";

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
  });

export const buildSendRawSchema = (channel: ChannelType) =>
  buildBaseSendSchema(channel)
    .extend(
      z.object({
        payload: sendRawPayloadSchemas[channel],
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
              .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
              .describe("Template variables and data")
              .meta({
                example: {
                  firstName: "John",
                  companyName: "Acme Inc",
                  verificationUrl: "https://app.example.com/verify/abc123",
                },
              }),
          })
          .describe("Template configuration"),
      }).shape
    )
    .describe("Send email using template");
