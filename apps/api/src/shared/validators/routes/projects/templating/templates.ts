import { safeString } from "@repo/api/validators/shared";
import { z } from "zod";

export const createTemplateBodySchema = z.object({
  name: safeString.min(1).max(256),
});

export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

export const patchTemplateBodySchema = z
  .object({
    name: safeString.min(1).max(256).optional(),
    /** Explicit send-path slug. Normalized server-side; must be unique among active Templates. */
    slug: safeString.min(1).max(128).optional(),
  })
  .refine((body) => body.name !== undefined || body.slug !== undefined, {
    message: "At least one of name or slug is required",
  });

export type PatchTemplateBody = z.infer<typeof patchTemplateBodySchema>;

export const templateIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type TemplateIdParams = z.infer<typeof templateIdParamsSchema>;

const primitiveVariableDefSchema = z
  .object({
    type: z.enum(["string", "number"]),
    fallback: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((def, ctx) => {
    if (def.fallback === undefined) {
      return;
    }
    if (def.type === "string" && typeof def.fallback !== "string") {
      ctx.addIssue({
        code: "custom",
        message: "fallback must be a string when type is string",
        path: ["fallback"],
      });
    }
    if (def.type === "number" && typeof def.fallback !== "number") {
      ctx.addIssue({
        code: "custom",
        message: "fallback must be a number when type is number",
        path: ["fallback"],
      });
    }
  });

export const primitiveTemplateVariablesSchema = z.record(
  z.string().min(1),
  primitiveVariableDefSchema
);

const putPrimitiveEmailChannelBodySchema = z
  .object({
    engine: z.literal("primitive"),
    content: z.object({
      subject: z.string().min(1),
      html: z.string().optional(),
      text: z.string().optional(),
    }),
    variables: primitiveTemplateVariablesSchema.optional(),
  })
  .refine(
    (body) =>
      body.content.html !== undefined || body.content.text !== undefined,
    { message: "At least one of content.html or content.text is required" }
  );

const putReactEmailChannelBodySchema = z.object({
  engine: z.literal("reactEmail"),
  workspaceEntryId: z.string().min(1),
  /** Subject lives on the Template variant, not in Entry source. */
  subject: safeString.min(1).max(998),
});

export const putTemplateEmailChannelBodySchema = z.discriminatedUnion(
  "engine",
  [putPrimitiveEmailChannelBodySchema, putReactEmailChannelBodySchema]
);

export type PutTemplateEmailChannelBody = z.infer<
  typeof putTemplateEmailChannelBodySchema
>;
