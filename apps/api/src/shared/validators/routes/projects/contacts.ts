import { contactPropertiesSchema } from "@repo/api/validators/shared";
import { z } from "zod";

const optionalAppEnvironmentFields = {
  app: z.string().min(1).nullable().optional(),
  environment: z.string().min(1).nullable().optional(),
};

export const upsertContactBodySchema = z.object({
  email: z.email(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  properties: contactPropertiesSchema.optional(),
  ...optionalAppEnvironmentFields,
});

export type UpsertContactBody = z.infer<typeof upsertContactBodySchema>;

export const listContactsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  ...optionalAppEnvironmentFields,
});

export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

export const contactIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type ContactIdParams = z.infer<typeof contactIdParamsSchema>;

export const updateContactBodySchema = z
  .object({
    email: z.email().optional(),
    firstName: z.string().min(1).nullable().optional(),
    lastName: z.string().min(1).nullable().optional(),
    properties: contactPropertiesSchema.nullable().optional(),
  })
  .refine(
    (body) =>
      body.email !== undefined ||
      body.firstName !== undefined ||
      body.lastName !== undefined ||
      body.properties !== undefined,
    { message: "At least one field is required" }
  );

export type UpdateContactBody = z.infer<typeof updateContactBodySchema>;
