import { z } from "zod";

export const updateBillingUserBodySchema = z.object({
  userId: z.string().min(1),
});

export type UpdateBillingUserBody = z.infer<typeof updateBillingUserBodySchema>;
