import { awsCredentialsSchema } from "@repo/provider-aws/credentials";
import { z } from "zod";

const nullableName = z
  .string()
  .nullable()
  .transform((val) => {
    if (!val || val.trim() === "") {
      return null;
    }
    return val;
  });

export const createPlatformProviderBodySchema = z.object({
  credentials: awsCredentialsSchema,
  isDefault: z.boolean().optional(),
  name: nullableName,
  productId: z.literal("ses"),
  vendorId: z.literal("aws"),
});

export const updatePlatformProviderBodySchema = z.object({
  credentials: awsCredentialsSchema.partial().optional(),
  isDefault: z.boolean().optional(),
  name: nullableName.optional(),
  providerId: z.string().min(1),
});

export const platformProviderIdSchema = z.object({
  providerId: z.string().min(1),
});

export type CreatePlatformProviderBody = z.infer<
  typeof createPlatformProviderBodySchema
>;
export type UpdatePlatformProviderBody = z.infer<
  typeof updatePlatformProviderBodySchema
>;
