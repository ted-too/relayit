import {
  BLOCKED_ATTACHMENT_FILENAME_MESSAGE,
  isBlockedAttachmentFilename,
} from "@repo/channels/email/attachment-policy";
import {
  type EmailFrom,
  emailHeadersSchema,
} from "@repo/persistence/db/validators/channels/email";
import { contactPropertiesSchema } from "@repo/persistence/db/validators/contact";
import { z } from "zod";
import { apiKeyHeadersSchema } from "../../../lib/api-key";

/** Max recipients per to/cc/bcc field (Resend). */
const MAX_RECIPIENTS = 50;

/** Resend Message Tag name/value charset. */
const TAG_TOKEN = /^[a-zA-Z0-9_-]+$/;

const FROM_ANGLE_ADDR = /^(.*?)\s*<([^<>]+)>\s*$/;
const FROM_QUOTED_NAME = /^"(.*)"$/;

/**
 * Relayit addition: enrich Accept upserts with Contact fields.
 * Resend `to`/`cc`/`bcc` are address strings only.
 */
export const emailContactSchema = z.object({
  email: z.email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  properties: contactPropertiesSchema.optional(),
});

export type EmailContact = z.infer<typeof emailContactSchema>;

/** Wire address list: email or email[] (Resend `reply_to`, etc.). */
export const emailAddressListWireSchema = z.union([
  z.email(),
  z.array(z.email()).max(MAX_RECIPIENTS),
]);

export type EmailAddressListWire = z.infer<typeof emailAddressListWireSchema>;

/**
 * Recipients: Resend string | string[], plus Relayit contact objects.
 */
export const emailContactRecipientSchema = z.union([
  z.email(),
  z.array(z.email()).max(MAX_RECIPIENTS),
  emailContactSchema,
  z.array(emailContactSchema).max(MAX_RECIPIENTS),
]);

export type EmailContactRecipient = z.infer<typeof emailContactRecipientSchema>;

export function parseEmailFrom(value: string): EmailFrom {
  const trimmed = value.trim();
  const angled = trimmed.match(FROM_ANGLE_ADDR);
  if (angled?.[2]) {
    const rawName = angled[1]?.trim() ?? "";
    const name = rawName.replace(FROM_QUOTED_NAME, "$1").trim();
    const address = angled[2].trim().toLowerCase();
    return {
      ...(name.length > 0 ? { name } : {}),
      address,
      normalized: trimmed,
    };
  }

  const address = trimmed.toLowerCase();
  return { address, normalized: address };
}

/** Wire From string. */
export const emailFromSchema = z
  .string()
  .min(1)
  .refine(
    (value) => z.email().safeParse(parseEmailFrom(value).address).success,
    { message: "Invalid from address" }
  )
  .describe('Sender. Resend format: email or "Name <email@example.com>".');

/** Resend [{ name, value }] tags. */
const emailTagItemSchema = z.object({
  name: z.string().min(1).max(256).regex(TAG_TOKEN, {
    message:
      "Tag name may only contain ASCII letters, numbers, underscores, or dashes",
  }),
  value: z.string().min(1).max(256).regex(TAG_TOKEN, {
    message:
      "Tag value may only contain ASCII letters, numbers, underscores, or dashes",
  }),
});

export const emailTagsSchema = z.array(emailTagItemSchema).optional();

export type EmailTags = z.infer<typeof emailTagsSchema>;

const filenameSchema = z
  .string()
  .min(1)
  .refine((name) => !isBlockedAttachmentFilename(name), {
    message: BLOCKED_ATTACHMENT_FILENAME_MESSAGE,
  });

/**
 * Resend attachment: `content` (base64) XOR `path` (hosted URL), plus filename.
 * Optional `content_id` (inline) and `content_type`.
 */
export const emailAttachmentSchema = z
  .object({
    filename: filenameSchema.describe(
      "Attachment filename including extension (used for MIME type)."
    ),
    content: z.string().optional().describe("Base64-encoded file contents."),
    path: z.url().optional().describe("HTTPS URL of a hosted file to attach."),
    content_type: z
      .string()
      .optional()
      .describe("MIME type; derived from filename when omitted."),
    content_id: z
      .string()
      .optional()
      .describe('Inline image id for HTML, e.g. <img src="cid:your-id">.'),
  })
  .refine(
    (attachment) => (attachment.content != null) !== (attachment.path != null),
    {
      message: "Each attachment requires exactly one of content or path",
      path: ["content"],
    }
  );

export type SendEmailAttachmentBody = z.infer<typeof emailAttachmentSchema>;

/**
 * Template send ref. XOR with inline html/text — see refine on
 * {@link sendEmailBodySchema}.
 */
export const emailTemplateRefSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("Template id (`tmpl_…`) or active Template slug."),
  variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Primitive Template variable values (string|number) or reactEmail props (structured JSON)."
    ),
});

export type EmailTemplateRef = z.infer<typeof emailTemplateRefSchema>;

/**
 * `POST /messages/email` body — Resend `POST /emails` compatible, plus Relayit
 * contact-object recipients. `topic_id` is rejected (marketing-only).
 */
export const sendEmailBodySchema = z
  .object({
    from: emailFromSchema,
    to: emailContactRecipientSchema.describe(
      "Recipients. Resend: address or address[]. Relayit also accepts contact objects."
    ),
    subject: z
      .string()
      .optional()
      .describe(
        "Email subject line. Required for inline html/text; optional with template (overrides template subject when set)."
      ),
    bcc: emailContactRecipientSchema.optional(),
    cc: emailContactRecipientSchema.optional(),
    scheduled_at: z
      .string()
      .min(1)
      .optional()
      .describe(
        "When to send: ISO 8601 (Resend also accepts natural language — ISO preferred)."
      ),
    reply_to: emailAddressListWireSchema.optional(),
    html: z.string().optional(),
    text: z.string().optional(),
    headers: emailHeadersSchema
      .optional()
      .describe("Custom headers to add to the email."),
    attachments: z.array(emailAttachmentSchema).optional(),
    tags: emailTagsSchema.describe(
      "Resend [{ name, value }] → Message Tags map."
    ),
    template: emailTemplateRefSchema.optional(),
    /** Rejected on this transactional facade — Campaign / marketing path only. */
    topic_id: z.never().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasInline = Boolean(data.html || data.text);
    const hasTemplate = data.template != null;

    if (hasInline === hasTemplate) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provide either inline html/text or template, not both (and not neither).",
        path: hasTemplate ? ["template"] : ["html"],
      });
    }

    if (hasInline && (data.subject == null || data.subject.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "subject is required when sending inline html/text",
        path: ["subject"],
      });
    }

    if (data.scheduled_at) {
      const when = Date.parse(data.scheduled_at);
      if (Number.isNaN(when)) {
        ctx.addIssue({
          code: "custom",
          message: "scheduled_at must be a parseable date (ISO 8601 preferred)",
          path: ["scheduled_at"],
        });
      }
    }
  });

export type SendEmailBody = z.infer<typeof sendEmailBodySchema>;

export const sendEmailHeadersSchema = apiKeyHeadersSchema.extend({
  app: z
    .string()
    .optional()
    .describe("App attribution (must pair with environment)."),
  environment: z
    .string()
    .optional()
    .describe("App Environment attribution (must pair with app)."),
  "idempotency-key": z
    .string()
    .max(256)
    .optional()
    .describe("Idempotency Key — same key returns the original Message."),
});

export type SendEmailHeaders = z.infer<typeof sendEmailHeadersSchema>;
