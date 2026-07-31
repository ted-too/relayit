import { safeString } from "@repo/api/validators/shared";
import { z } from "zod";

export const createApiKeyBodySchema = z.object({
  name: safeString,
  expiresAt: z.iso.datetime().optional(),
});

export type CreateApiKeyBody = z.infer<typeof createApiKeyBodySchema>;

export const apiKeyIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type ApiKeyIdParams = z.infer<typeof apiKeyIdParamsSchema>;
