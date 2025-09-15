import { z } from "zod";
import { AVAILABLE_CHANNELS } from "@/providers";

// Control characters regex for display name validation
// biome-ignore lint/suspicious/noControlCharactersInRegex: Control characters should be explicitly blocked
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

// Display name validator for email identities - more permissive than safeString
export const displayName = z
  .string()
  .min(1, "Display name is required")
  .max(100, "Display name must be 100 characters or less")
  .trim()
  .refine((val) => !CONTROL_CHARS_REGEX.test(val), {
    message: "Control characters are not allowed",
  });

// Channel-specific data schema
export const channelDataSchema = z.object({
  email: z
    .object({
      name: displayName.optional(),
    })
    .optional(),
});

export type ChannelSpecificData = z.infer<typeof channelDataSchema>;

export const createIntegrationSchema = z.object({
  priority: z.coerce
    .number()
    .nullish()
    .refine((val) => val === null || val === undefined || val >= 0, {
      message: "Priority must be a positive number or null",
    }),
  name: z.string().min(1, "Name is required").nullish(),
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
  channelData: channelDataSchema.optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const updateIdentitySchema = z.object({
  id: z.string().min(1, "Identity ID is required"),
  identifier: z.string().min(1, "Identifier is required").optional(),
  channelData: channelDataSchema.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
