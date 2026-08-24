import { type Static, t } from "elysia";

const stringMap = t.Object({}, { additionalProperties: t.String() });

const legacyAttachmentSchema = t.Union([
  t.Object(
    {
      content: t.String(),
      contentId: t.Optional(t.String()),
      contentType: t.Optional(t.String()),
      filename: t.String({ minLength: 1 }),
    },
    { additionalProperties: false, title: "Base64 attachment" }
  ),
  t.Object(
    {
      contentId: t.Optional(t.String()),
      contentType: t.Optional(t.String()),
      filename: t.String({ minLength: 1 }),
      path: t.String({ format: "uri" }),
    },
    { additionalProperties: false, title: "Hosted attachment" }
  ),
]);

const legacyContactSchema = t.Object(
  {
    externalIdentifiers: t.Optional(stringMap),
    name: t.Optional(t.String()),
  },
  { additionalProperties: false }
);

const legacyBase = {
  app: t.Optional(t.String()),
  appEnvironment: t.Optional(t.String()),
  attachments: t.Optional(t.Array(legacyAttachmentSchema, { maxItems: 20 })),
  contact: t.Optional(legacyContactSchema),
  from: t.Optional(t.String({ format: "email" })),
  to: t.String({ format: "email" }),
};

const legacyInlinePayloadSchema = t.Union([
  t.Object(
    {
      html: t.String(),
      subject: t.String({ minLength: 1 }),
      text: t.Optional(t.String()),
    },
    { additionalProperties: false }
  ),
  t.Object(
    {
      html: t.Optional(t.String()),
      subject: t.String({ minLength: 1 }),
      text: t.String(),
    },
    { additionalProperties: false }
  ),
]);

export const legacySendRawBodySchema = t.Object(
  {
    ...legacyBase,
    payload: legacyInlinePayloadSchema,
  },
  { additionalProperties: false }
);

export const legacySendTemplateBodySchema = t.Object(
  {
    ...legacyBase,
    template: t.Object(
      {
        props: t.Optional(t.Object({}, { additionalProperties: t.Any() })),
        slug: t.String({ minLength: 1 }),
      },
      { additionalProperties: false }
    ),
  },
  { additionalProperties: false }
);

export const legacySendProjectParamsSchema = t.Object({
  project: t.String({ minLength: 1 }),
});

export const legacyApiKeyHeadersSchema = t.Object({
  "X-API-Key": t.Optional(t.String()),
  "x-api-key": t.Optional(t.String()),
});

export type LegacySendRawBody = Static<typeof legacySendRawBodySchema>;
export type LegacySendTemplateBody = Static<
  typeof legacySendTemplateBodySchema
>;
