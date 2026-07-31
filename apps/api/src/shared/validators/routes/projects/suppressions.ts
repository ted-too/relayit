import { zContactSuppressionSeverity } from "@repo/api/db/schema/contact";
import { z } from "zod";

export const createSuppressionBodySchema = z.object({
  contactId: z.string().min(1),
  severity: zContactSuppressionSeverity,
});

export type CreateSuppressionBody = z.infer<typeof createSuppressionBodySchema>;

export const suppressionContactIdParamsSchema = z.object({
  contactId: z.string().min(1),
});

export type SuppressionContactIdParams = z.infer<
  typeof suppressionContactIdParamsSchema
>;
