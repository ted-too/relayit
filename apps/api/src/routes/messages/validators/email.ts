import {
  BLOCKED_ATTACHMENT_FILENAME_MESSAGE,
  isBlockedAttachmentFilename,
} from "@repo/channels/email/attachment-policy";
import type { EmailFrom } from "@repo/persistence/db/validators/channels/email";
import { getSchemaValidator, type Static, t } from "elysia";

/** Max recipients per to/cc/bcc field. */
const MAX_RECIPIENTS = 50;

/** Tag name/value charset. */
const TAG_TOKEN = "^[a-zA-Z0-9_-]+$";

const FROM_ANGLE_ADDR = /^(.*?)\s*<([^<>]+)>\s*$/;
const FROM_QUOTED_NAME = /^"(.*)"$/;

const emailAddress = t.String({
  format: "email",
  title: "Email address",
});

const emailAddressCheck = getSchemaValidator(emailAddress);
if (!emailAddressCheck) {
  throw new Error("email address validator failed to compile");
}

const componentId = {
  Attachment: "#/components/schemas/Attachment",
  Contact: "#/components/schemas/Contact",
  EmailAddressList: "#/components/schemas/EmailAddressList",
  Recipient: "#/components/schemas/Recipient",
} as const;

const stringMap = t.Object({}, { additionalProperties: t.String() });

/** Recipients may be address strings or Contact objects. */
export const emailContactSchema = t.Object(
  {
    email: t.String({ format: "email" }),
    first_name: t.Optional(t.String()),
    last_name: t.Optional(t.String()),
    properties: t.Optional(stringMap),
  },
  {
    $id: componentId.Contact,
    additionalProperties: false,
    title: "Contact",
  }
);

export type EmailContact = Static<typeof emailContactSchema>;

/** Wire address list: email or email[]. */
export const emailAddressListSchema = t.Union(
  [
    emailAddress,
    t.Array(t.String({ format: "email" }), {
      maxItems: MAX_RECIPIENTS,
      title: "Email addresses",
    }),
  ],
  { $id: componentId.EmailAddressList, title: "Email address list" }
);

export type EmailAddressListWire = Static<typeof emailAddressListSchema>;

/** Recipients: address, address list, or contact objects. */
export const emailRecipientSchema = t.Union(
  [
    emailAddress,
    t.Array(t.String({ format: "email" }), {
      maxItems: MAX_RECIPIENTS,
      title: "Email addresses",
    }),
    t.Ref(componentId.Contact),
    t.Array(t.Ref(componentId.Contact), {
      maxItems: MAX_RECIPIENTS,
      title: "Contacts",
    }),
  ],
  {
    $id: componentId.Recipient,
    description: "Address, address list, or contact objects.",
    title: "Recipient",
  }
);

export type EmailContactRecipient =
  | string
  | string[]
  | EmailContact
  | EmailContact[];

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

export function tryParseEmailFrom(value: string): EmailFrom | undefined {
  const parsed = parseEmailFrom(value);
  if (!emailAddressCheck.Check(parsed.address)) {
    return;
  }
  return parsed;
}

const filenameSchema = t.String({
  description: "Attachment filename including extension (used for MIME type).",
  minLength: 1,
});

const attachmentMeta = {
  content_id: t.Optional(
    t.String({
      description: 'Inline image id for HTML, e.g. <img src="cid:your-id">.',
    })
  ),
  content_type: t.Optional(
    t.String({
      description: "MIME type; derived from filename when omitted.",
    })
  ),
  filename: filenameSchema,
};

/** Attachment: base64 `content` or hosted `path`, plus filename. */
export const emailAttachmentSchema = t.Union(
  [
    t.Object(
      {
        ...attachmentMeta,
        content: t.String({
          description: "Base64-encoded file contents.",
        }),
      },
      { additionalProperties: false, title: "Base64 attachment" }
    ),
    t.Object(
      {
        ...attachmentMeta,
        path: t.String({
          description: "HTTPS URL of a hosted file to attach.",
          format: "uri",
        }),
      },
      { additionalProperties: false, title: "Hosted attachment" }
    ),
  ],
  { $id: componentId.Attachment, title: "Attachment" }
);

export type SendEmailAttachmentBody = Static<typeof emailAttachmentSchema>;

/**
 * Template send ref. XOR with inline html/text — see
 * {@link refineSendEmailBody}.
 */
export const emailTemplateRefSchema = t.Object(
  {
    id: t.String({
      description: "Template id (`tmpl_…`) or active Template slug.",
      minLength: 1,
    }),
    variables: t.Optional(
      t.Object(
        {},
        {
          additionalProperties: t.Any(),
          description:
            "Primitive Template variable values (string|number) or reactEmail props (structured JSON).",
        }
      )
    ),
  },
  { additionalProperties: false }
);

export type EmailTemplateRef = Static<typeof emailTemplateRefSchema>;

const emailTagItemSchema = t.Object(
  {
    name: t.String({
      maxLength: 256,
      minLength: 1,
      pattern: TAG_TOKEN,
    }),
    value: t.String({
      maxLength: 256,
      minLength: 1,
      pattern: TAG_TOKEN,
    }),
  },
  { additionalProperties: false, title: "Tag" }
);

export const emailTagsSchema = t.Array(emailTagItemSchema);

export type EmailTags = Static<typeof emailTagsSchema>;

/**
 * Named OpenAPI components for send-email unions. Register with `.model()`
 * before using {@link sendEmailBodySchema} on a route.
 */
export const sendEmailOpenApiModels = {
  Attachment: emailAttachmentSchema,
  Contact: emailContactSchema,
  EmailAddressList: emailAddressListSchema,
  Recipient: emailRecipientSchema,
};

/**
 * `POST /messages/email` body. Extra properties (including campaign
 * `topic_id`) are rejected.
 */
export const sendEmailBodySchema = t.Object(
  {
    from: t.String({
      description: 'Sender. Email or "Name <email@example.com>".',
      minLength: 1,
    }),
    to: t.Ref(componentId.Recipient),
    subject: t.Optional(
      t.String({
        description:
          "Email subject line. Required for inline html/text; optional with template (overrides template subject when set).",
      })
    ),
    bcc: t.Optional(t.Ref(componentId.Recipient)),
    cc: t.Optional(t.Ref(componentId.Recipient)),
    scheduled_at: t.Optional(
      t.String({
        description: "When to send. ISO 8601 preferred.",
        minLength: 1,
      })
    ),
    reply_to: t.Optional(t.Ref(componentId.EmailAddressList)),
    html: t.Optional(t.String()),
    text: t.Optional(t.String()),
    headers: t.Optional(
      t.Object(
        {},
        {
          additionalProperties: t.String(),
          description: "Custom headers to add to the email.",
        }
      )
    ),
    attachments: t.Optional(t.Array(t.Ref(componentId.Attachment))),
    tags: t.Optional(
      t.Array(emailTagItemSchema, {
        description: "Tags as { name, value } pairs.",
      })
    ),
    template: t.Optional(emailTemplateRefSchema),
  },
  { additionalProperties: false }
);

export interface SendEmailBody {
  attachments?: SendEmailAttachmentBody[];
  bcc?: EmailContactRecipient;
  cc?: EmailContactRecipient;
  from: string;
  headers?: Record<string, string>;
  html?: string;
  reply_to?: EmailAddressListWire;
  scheduled_at?: string;
  subject?: string;
  tags?: EmailTags;
  template?: EmailTemplateRef;
  text?: string;
  to: EmailContactRecipient;
}

export function refineSendEmailBody(body: SendEmailBody): string | undefined {
  if (tryParseEmailFrom(body.from) === undefined) {
    return "Invalid from address";
  }

  const hasInline = Boolean(body.html || body.text);
  const hasTemplate = body.template != null;

  if (hasInline === hasTemplate) {
    return "Provide either inline html/text or template, not both (and not neither).";
  }

  if (hasInline && (body.subject == null || body.subject.length === 0)) {
    return "subject is required when sending inline html/text";
  }

  if (body.scheduled_at) {
    const when = Date.parse(body.scheduled_at);
    if (Number.isNaN(when)) {
      return "scheduled_at must be a parseable date (ISO 8601 preferred)";
    }
  }

  for (const attachment of body.attachments ?? []) {
    if (isBlockedAttachmentFilename(attachment.filename)) {
      return BLOCKED_ATTACHMENT_FILENAME_MESSAGE;
    }
  }
}

export const sendEmailHeadersSchema = t.Object({
  app: t.Optional(
    t.String({
      description: "App attribution (must pair with environment).",
    })
  ),
  environment: t.Optional(
    t.String({
      description: "App Environment attribution (must pair with app).",
    })
  ),
  "idempotency-key": t.Optional(
    t.String({
      description: "Idempotency Key — same key returns the original Message.",
      maxLength: 256,
    })
  ),
  "x-api-key": t.String({
    description: "The API key to use for the request.",
  }),
});

export type SendEmailHeaders = Static<typeof sendEmailHeadersSchema>;
