import { z } from "zod";

const legacyAttachmentSchema = z
  .object({
    content: z.string().optional(),
    contentId: z.string().optional(),
    contentType: z.string().optional(),
    filename: z.string().min(1),
    path: z.url().optional(),
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
  externalIdentifiers: z.record(z.string(), z.string()).optional(),
  name: z.string().optional(),
});

const legacyBaseSchema = z.object({
  app: z.string().optional(),
  appEnvironment: z.string().optional(),
  attachments: z.array(legacyAttachmentSchema).max(20).optional(),
  contact: legacyContactSchema.optional(),
  from: z.email().optional(),
  to: z.email(),
});

export const legacySendRawBodySchema = legacyBaseSchema.extend({
  payload: z
    .object({
      html: z.string().optional(),
      subject: z.string().min(1),
      text: z.string().optional(),
    })
    .refine((data) => data.html !== undefined || data.text !== undefined, {
      message: "At least one of 'html' or 'text' must be provided",
      path: ["html"],
    }),
});

export const legacySendTemplateBodySchema = legacyBaseSchema.extend({
  template: z.object({
    props: z.record(z.string(), z.unknown()).optional(),
    slug: z.string().min(1),
  }),
});

export const legacySendProjectParamsSchema = z.object({
  project: z.string().min(1),
});

export const legacyApiKeyHeadersSchema = z
  .object({
    "X-API-Key": z.string().optional(),
    "x-api-key": z.string().optional(),
  })
  .refine((headers) => Boolean(headers["x-api-key"] ?? headers["X-API-Key"]), {
    message: "Unauthorized",
    path: ["x-api-key"],
  });
