import { z } from "zod";
import {
  AVAILABLE_TEMPLATE_CATEGORIES,
  AVAILABLE_TEMPLATE_STATUSES,
  type ChannelType,
} from "@/providers";
import { safeString } from "./shared";

// Email template engine types
export const emailTemplateEngineEnum = z.enum([
  "react-email",
  // Future engines:
  // "mjml",
  // "handlebars",
  // "liquid",
]);

export const emailContentSchema = z.object({
  engine: emailTemplateEngineEnum,
  subject: z.string().min(1, "Subject is required"),
  template: z.string().min(1, "Template code is required"),
});

export type EmailContent = z.infer<typeof emailContentSchema>;

// Future channel content schemas (commented out for now)
// const smsContentSchema = z.object({
//   text: z.string().min(1, "SMS text is required").max(160, "SMS must be 160 characters or less"),
// });

// const whatsappContentSchema = z.object({
//   text: z.string().min(1, "WhatsApp text is required"),
//   media: z.object({
//     type: z.enum(["image", "video", "document"]),
//     url: z.string().url(),
//   }).optional(),
// });

// const discordContentSchema = z.object({
//   content: z.string().min(1, "Discord content is required"),
//   embeds: z.array(z.object({
//     title: z.string().optional(),
//     description: z.string().optional(),
//     color: z.number().optional(),
//     fields: z.array(z.object({
//       name: z.string(),
//       value: z.string(),
//       inline: z.boolean().optional(),
//     })).optional(),
//   })).optional(),
// });

export const channelContentSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("email" satisfies ChannelType),
    content: emailContentSchema,
  }),
  // Future channels can be added here:
  // z.object({
  //   channel: z.literal("sms"),
  //   content: smsContentSchema,
  // }),
  // z.object({
  //   channel: z.literal("whatsapp"),
  //   content: whatsappContentSchema,
  // }),
  // z.object({
  //   channel: z.literal("discord"),
  //   content: discordContentSchema,
  // }),
]);

export type ChannelContent = z.infer<typeof channelContentSchema>;

export const createTemplateSchema = z.object({
  name: safeString,
  slug: safeString,
  category: z.enum(AVAILABLE_TEMPLATE_CATEGORIES),

  // This is a JSON schema string
  schema: z.string().optional().transform((val) => (val ? JSON.parse(val) : undefined)),

  channelVersions: z
    .array(channelContentSchema)
    .min(1, "At least one channel must be configured")
    .refine(
      (channels) => {
        const channelIds = channels.map((c) => c.channel);
        return new Set(channelIds).size === channelIds.length;
      },
      { message: "Each channel can only be configured once" }
    ),
});

export type CreateTemplateRequest = z.infer<typeof createTemplateSchema>;

// Update schema - allows partial updates to template metadata and creates new versions for content changes
export const updateTemplateSchema = z.object({
  id: z.string().min(1, "Template ID is required"),

  // Template metadata updates (optional)
  name: safeString.optional(),
  slug: safeString.optional(),
  category: z.enum(AVAILABLE_TEMPLATE_CATEGORIES).optional(),
  status: z.enum(AVAILABLE_TEMPLATE_STATUSES).optional(),

  // Content updates (optional) - if provided, creates a new version
  schema: z
    .string()
    .optional()
    .transform((val) => (val ? JSON.parse(val) : undefined)),
  channelVersions: z
    .array(channelContentSchema)
    .min(1, "At least one channel must be configured")
    .refine(
      (channels) => {
        const channelIds = channels.map((c) => c.channel);
        return new Set(channelIds).size === channelIds.length;
      },
      { message: "Each channel can only be configured once" }
    )
    .optional(),
});

export type UpdateTemplateRequest = z.infer<typeof updateTemplateSchema>;
// export type EmailTemplateEngine = z.infer<typeof emailTemplateEngineEnum>;
// export type EmailContentSchema = z.infer<typeof emailContentSchema>;
// export type ReactEmailContent = z.infer<typeof reactEmailContentSchema>;

// // Helper type to extract channel content by channel type
// export type ChannelContent<T extends string> = Extract<
//   z.infer<typeof channelContentSchema>,
//   { channel: T }
// >["content"];

// // Specific email content type
// export type EmailChannelContent = ChannelContent<"email">;
