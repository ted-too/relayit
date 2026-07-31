import * as z from "zod";

/** Old prod attachment input (camelCase Resend-style). */
const legacyAttachmentSchema = z
  .object({
    filename: z.string().min(1),
    content: z.string().optional(),
    path: z.url().optional(),
    contentType: z.string().optional(),
    contentId: z.string().optional(),
  })
  .refine(
    (data) =>
      Number(data.content !== undefined) + Number(data.path !== undefined) ===
      1,
    {
      message: "Exactly one of 'content' or 'path' must be provided",
      path: ["content"],
    }
  );

const legacyContactSchema = z.object({
  name: z.string().optional(),
  externalIdentifiers: z.record(z.string(), z.string()).optional(),
});

const legacyBaseSchema = z.object({
  to: z.email(),
  from: z.email().optional(),
  contact: legacyContactSchema.optional(),
  app: z.string().optional(),
  appEnvironment: z.string().optional(),
  attachments: z.array(legacyAttachmentSchema).max(20).optional(),
});

export const legacySendRawBodySchema = legacyBaseSchema.extend({
  payload: z
    .object({
      subject: z.string().min(1),
      html: z.string().optional(),
      text: z.string().optional(),
    })
    .refine((data) => data.html !== undefined || data.text !== undefined, {
      message: "At least one of 'html' or 'text' must be provided",
      path: ["html"],
    }),
});

export type LegacySendRawBody = z.infer<typeof legacySendRawBodySchema>;

export const legacySendTemplateBodySchema = legacyBaseSchema.extend({
  template: z.object({
    slug: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type LegacySendTemplateBody = z.infer<
  typeof legacySendTemplateBodySchema
>;

export const legacySendProjectParamsSchema = z.object({
  project: z.string().min(1),
});

/** Accept `X-API-Key` or `x-api-key` (old clients used the former). */
export const legacyApiKeyHeadersSchema = z
  .object({
    "x-api-key": z.string().optional(),
    "X-API-Key": z.string().optional(),
  })
  .transform((headers, ctx) => {
    const key = headers["x-api-key"] ?? headers["X-API-Key"];
    if (!key) {
      ctx.addIssue({
        code: "custom",
        message: "Unauthorized",
        path: ["x-api-key"],
      });
      return z.NEVER;
    }
    return { "x-api-key": key };
  });
