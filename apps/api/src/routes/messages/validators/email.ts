import {
  BLOCKED_ATTACHMENT_FILENAME_MESSAGE,
  isBlockedAttachmentFilename,
} from "@repo/channels/email/attachment-policy";
import type { EmailFrom } from "@repo/persistence/db/validators/channels/email";
import { Schema } from "effect";

/** Max recipients per to/cc/bcc field. */
const MAX_RECIPIENTS = 50;

/** Tag name/value charset. */
const TAG_TOKEN = /^[a-zA-Z0-9_-]+$/;

const FROM_ANGLE_ADDR = /^(.*?)\s*<([^<>]+)>\s*$/;
const FROM_QUOTED_NAME = /^"(.*)"$/;

// The `email` and `uri` formats the api validated against before it moved to Effect
// (Elysia's, from ajv-formats). Kept as they were, so no address or attachment URL a
// customer sends changes between accepted and refused.
const EMAIL_FORMAT =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const NOT_URI_FRAGMENT = /\/|:/;
const URI_FORMAT =
  /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;

export const isEmailAddress = (value: string) => EMAIL_FORMAT.test(value);

/** A string in the `email` format; the legacy endpoints use it too. */
export const EmailAddressString = Schema.String.check(
  Schema.makeFilter(isEmailAddress, {
    expected: "an email address",
    toJsonSchema: () => [{ format: "email" }, true],
  }),
);

/** A string in the `uri` format. */
export const UriString = Schema.String.check(
  Schema.makeFilter((value: string) => NOT_URI_FRAGMENT.test(value) && URI_FORMAT.test(value), {
    expected: "a URI",
    toJsonSchema: () => [{ format: "uri" }, true],
  }),
);

const emailAddress = EmailAddressString.annotate({ title: "Email address" });

const emailAddresses = Schema.Array(EmailAddressString)
  .check(Schema.isMaxLength(MAX_RECIPIENTS))
  .annotate({ title: "Email addresses" });

const stringMap = Schema.Record(Schema.String, Schema.String);

/** A recipient as an object, with what Relayit stores on its Contact. */
export const Contact = Schema.Struct({
  email: EmailAddressString,
  first_name: Schema.optionalKey(Schema.String),
  last_name: Schema.optionalKey(Schema.String),
  properties: Schema.optionalKey(stringMap),
}).annotate({ identifier: "Contact", title: "Contact" });

export type EmailContact = typeof Contact.Type;

/** Wire address list: email or email[]. */
const EmailAddressList = Schema.Union([emailAddress, emailAddresses]).annotate({
  identifier: "EmailAddressList",
  title: "Email address list",
});

/** Recipients: address, address list, or contact objects. */
const Recipient = Schema.Union([
  emailAddress,
  emailAddresses,
  Contact,
  Schema.Array(Contact).check(Schema.isMaxLength(MAX_RECIPIENTS)).annotate({ title: "Contacts" }),
]).annotate({
  description: "Address, address list, or contact objects.",
  identifier: "Recipient",
  title: "Recipient",
});

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
  if (!isEmailAddress(parsed.address)) {
    return;
  }
  return parsed;
}

const attachmentMeta = {
  content_id: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Inline image id for HTML, e.g. <img src="cid:your-id">.',
    }),
  ),
  content_type: Schema.optionalKey(
    Schema.String.annotate({ description: "MIME type; derived from filename when omitted." }),
  ),
  filename: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Attachment filename including extension (used for MIME type).",
  }),
};

/**
 * Attachment: base64 `content` or hosted `path`, plus filename. Never both: neither member
 * may carry the other's field, so one with both is refused rather than read as either.
 */
const Attachment = Schema.Union([
  Schema.Struct({
    ...attachmentMeta,
    content: Schema.String.annotate({ description: "Base64-encoded file contents." }),
    path: Schema.optionalKey(Schema.Never),
  }).annotate({ title: "Base64 attachment" }),
  Schema.Struct({
    ...attachmentMeta,
    content: Schema.optionalKey(Schema.Never),
    path: UriString.annotate({ description: "HTTPS URL of a hosted file to attach." }),
  }).annotate({ title: "Hosted attachment" }),
]).annotate({ identifier: "Attachment", title: "Attachment" });

const tagToken = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(TAG_TOKEN),
);

/**
 * `POST /messages/email` body. Fields it does not know, `topic_id` among them, are
 * dropped, as they were before.
 */
export const SendEmailBody = Schema.Struct({
  from: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'Sender. Email or "Name <email@example.com>".',
  }),
  to: Recipient,
  subject: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Email subject line. Required for inline html/text; optional with template (overrides template subject when set).",
    }),
  ),
  bcc: Schema.optionalKey(Recipient),
  cc: Schema.optionalKey(Recipient),
  scheduled_at: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).annotate({
      description: "When to send. ISO 8601 preferred.",
    }),
  ),
  reply_to: Schema.optionalKey(EmailAddressList),
  html: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  headers: Schema.optionalKey(
    stringMap.annotate({ description: "Custom headers to add to the email." }),
  ),
  attachments: Schema.optionalKey(Schema.Array(Attachment)),
  tags: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ name: tagToken, value: tagToken }).annotate({ title: "Tag" }),
    ).annotate({
      description: "Tags as { name, value } pairs.",
    }),
  ),
  template: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: "Template id (`tmpl_…`) or active Template slug.",
      }),
      variables: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.Unknown).annotate({
          description:
            "Primitive Template variable values (string|number) or reactEmail props (structured JSON).",
        }),
      ),
    }),
  ),
});

export type SendEmailBody = typeof SendEmailBody.Type;

export const SendEmailHeaders = Schema.Struct({
  app: Schema.optionalKey(
    Schema.String.annotate({ description: "App attribution (must pair with environment)." }),
  ),
  environment: Schema.optionalKey(
    Schema.String.annotate({ description: "App Environment attribution (must pair with app)." }),
  ),
  "idempotency-key": Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(256)).annotate({
      description: "Idempotency Key — same key returns the original Message.",
    }),
  ),
  "x-api-key": Schema.String.annotate({ description: "The API key to use for the request." }),
});

/** What the schema can't say: the checks that span fields, with the message each fails with. */
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
