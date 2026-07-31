import { z } from "zod";

export const appEnvironmentIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type AppEnvironmentIdParams = z.infer<
  typeof appEnvironmentIdParamsSchema
>;
