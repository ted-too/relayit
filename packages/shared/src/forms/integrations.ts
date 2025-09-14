import { z } from "zod";
import { AVAILABLE_CHANNELS } from "@/providers";
import { safeString } from "./shared";

export const createIntegrationSchema = z.object({
  priority: z.coerce
    .number()
    .nullish()
    .refine((val) => val === null || val === undefined || val >= 0, {
      message: "Priority must be a positive number or null",
    }),
  name: safeString.nullish(),
  provider: z.string(),
  channels: z
    .array(z.enum(AVAILABLE_CHANNELS))
    .min(1, "At least one channel must be selected"),
  isDefault: z.boolean(),
  isActive: z.boolean().default(true),
  credentials: z.any(),
});
