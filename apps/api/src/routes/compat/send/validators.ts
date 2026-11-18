import { Schema } from "effect";
import { EmailAddressString, UriString } from "../../messages/validators/email";

const stringMap = Schema.Record(Schema.String, Schema.String);
const nonEmpty = Schema.String.check(Schema.isMinLength(1));

const LegacyAttachment = Schema.Union([
  Schema.Struct({
    content: Schema.String,
    contentId: Schema.optionalKey(Schema.String),
    contentType: Schema.optionalKey(Schema.String),
    filename: nonEmpty,
  }).annotate({ title: "Base64 attachment" }),
  Schema.Struct({
    contentId: Schema.optionalKey(Schema.String),
    contentType: Schema.optionalKey(Schema.String),
    filename: nonEmpty,
    path: UriString,
  }).annotate({ title: "Hosted attachment" }),
]);

const legacyBase = {
  app: Schema.optionalKey(Schema.String),
  appEnvironment: Schema.optionalKey(Schema.String),
  attachments: Schema.optionalKey(Schema.Array(LegacyAttachment).check(Schema.isMaxLength(20))),
  contact: Schema.optionalKey(
    Schema.Struct({
      externalIdentifiers: Schema.optionalKey(stringMap),
      name: Schema.optionalKey(Schema.String),
    }),
  ),
  from: Schema.optionalKey(EmailAddressString),
  to: EmailAddressString,
};

export const LegacySendRawBody = Schema.Struct({
  ...legacyBase,
  payload: Schema.Union([
    Schema.Struct({
      html: Schema.String,
      subject: nonEmpty,
      text: Schema.optionalKey(Schema.String),
    }),
    Schema.Struct({
      html: Schema.optionalKey(Schema.String),
      subject: nonEmpty,
      text: Schema.String,
    }),
  ]),
});

export const LegacySendTemplateBody = Schema.Struct({
  ...legacyBase,
  template: Schema.Struct({
    props: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    slug: nonEmpty,
  }),
});

export const LegacySendParams = Schema.Struct({ project: nonEmpty });

/** Both spellings are the same header; the docs have always named `X-API-Key` too. */
export const LegacySendHeaders = Schema.Struct({
  "x-api-key": Schema.optionalKey(
    Schema.String.annotate({ description: "The API key; `X-API-Key` works too." }),
  ),
});

export type LegacySendRawBody = typeof LegacySendRawBody.Type;
export type LegacySendTemplateBody = typeof LegacySendTemplateBody.Type;
