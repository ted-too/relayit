import { z } from "zod";
import { apiKeyHeadersSchema, contactPropertiesSchema } from "../../shared";

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

/** Address list: string or string[] → string[] (Resend `reply_to`, etc.). */
export const emailAddressListSchema = z
  .union([z.email(), z.array(z.email()).max(MAX_RECIPIENTS)])
  .transform((val) => (Array.isArray(val) ? val : [val]));

export type EmailAddressList = z.infer<typeof emailAddressListSchema>;

/** Stored recipient address list on Delivery (`to`/`cc`/`bcc`/`reply_to`). */
export type EmailBasicRecipient = EmailAddressList;

/**
 * Recipients: Resend string | string[], plus Relayit contact objects.
 * Always normalized to `{ email, first_name?, last_name?, properties? }[]`.
 */
export const emailContactRecipientSchema = z
  .union([
    z.email(),
    z.array(z.email()).max(MAX_RECIPIENTS),
    emailContactSchema,
    z.array(emailContactSchema).max(MAX_RECIPIENTS),
  ])
  .transform((val) => {
    if (Array.isArray(val)) {
      return val.map((item) =>
        typeof item === "object" ? item : { email: item }
      );
    }
    return typeof val === "object" ? [val] : [{ email: val }];
  });

export type EmailContactRecipient = z.infer<typeof emailContactRecipientSchema>;

/**
 * Parsed From. Wire format is Resend's string (`email` or `Name <email>`).
 * Stored on Delivery as this object for provider send.
 */
export interface EmailFrom {
  address: string;
  name?: string;
  normalized: string;
}

function parseEmailFrom(value: string): EmailFrom {
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

export const emailFromSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const parsed = parseEmailFrom(value);
    if (!z.email().safeParse(parsed.address).success) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid from address",
      });
      return z.NEVER;
    }
    return parsed;
  })
  .describe('Sender. Resend format: email or "Name <email@example.com>".');

export const emailHeadersSchema = z
  .record(z.string(), z.string())
  .describe("Custom headers to add to the email.");

export type EmailHeaders = z.infer<typeof emailHeadersSchema>;

/** Resend tags → Message Tags map (key/value on the Message). */
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

export const emailTagsSchema = z
  .array(emailTagItemSchema)
  .transform((tags) =>
    Object.fromEntries(tags.map((tag) => [tag.name, tag.value]))
  )
  .optional();

export type EmailTags = z.infer<typeof emailTagsSchema>;

// Executable / script extensions SES (and others) reject — fail at Accept.
// https://docs.aws.amazon.com/ses/latest/dg/attachments.html
const blockedExtensions = [
  "ade",
  "adp",
  "app",
  "asp",
  "bas",
  "bat",
  "cer",
  "chm",
  "cmd",
  "com",
  "cpl",
  "crt",
  "csh",
  "der",
  "exe",
  "fxp",
  "gadget",
  "hlp",
  "hta",
  "inf",
  "ins",
  "isp",
  "its",
  "js",
  "jse",
  "ksh",
  "lib",
  "lnk",
  "mad",
  "maf",
  "mag",
  "mam",
  "maq",
  "mar",
  "mas",
  "mat",
  "mau",
  "mav",
  "maw",
  "mda",
  "mdb",
  "mde",
  "mdt",
  "mdw",
  "mdz",
  "msc",
  "msh",
  "msh1",
  "msh2",
  "mshxml",
  "msh1xml",
  "msh2xml",
  "msi",
  "msp",
  "mst",
  "ops",
  "pcd",
  "pif",
  "plg",
  "prf",
  "prg",
  "reg",
  "scf",
  "scr",
  "sct",
  "shb",
  "shs",
  "sys",
  "ps1",
  "ps1xml",
  "ps2",
  "ps2xml",
  "psc1",
  "psc2",
  "tmp",
  "url",
  "vb",
  "vbe",
  "vbs",
  "vps",
  "vsmacros",
  "vss",
  "vst",
  "vsw",
  "vxd",
  "ws",
  "wsc",
  "wsf",
  "wsh",
  "xnk",
] as const;

const blockedExtensionRegex = new RegExp(
  `\\.(${blockedExtensions.join("|")})$`,
  "i"
);

const filenameSchema = z
  .string()
  .min(1)
  .refine((name) => !blockedExtensionRegex.test(name), {
    message: "This file type isn't allowed for security reasons.",
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

export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

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
    reply_to: emailAddressListSchema.optional(),
    html: z.string().optional(),
    text: z.string().optional(),
    headers: emailHeadersSchema.optional(),
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
