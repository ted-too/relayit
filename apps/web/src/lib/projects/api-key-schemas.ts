import { z } from "zod";
import { safeString } from "@/lib/projects/schemas";

/** Client form values for create/update API key. */
export const apiKeyFormSchema = z.object({
  expiresAt: z.iso.datetime().optional(),
  name: safeString,
});

export const createApiKeyInputSchema = apiKeyFormSchema.extend({
  orgSlug: z.string().min(1),
});

export const updateApiKeyInputSchema = apiKeyFormSchema.extend({
  id: z.string().min(1),
  orgSlug: z.string().min(1),
});

export const listApiKeysInputSchema = z.object({
  orgSlug: z.string().min(1),
});

export type ApiKeyFormValues = z.infer<typeof apiKeyFormSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;
export type UpdateApiKeyInput = z.infer<typeof updateApiKeyInputSchema>;
