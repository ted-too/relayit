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

export const createIdentitySchema = z.object({
  providerCredentialId: z.string().min(1, "Provider credential ID is required"),
  identifier: z.string().min(1, "Identifier is required"),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const updateIdentitySchema = z.object({
  id: z.string().min(1, "Identity ID is required"),
  identifier: z.string().min(1, "Identifier is required").optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
