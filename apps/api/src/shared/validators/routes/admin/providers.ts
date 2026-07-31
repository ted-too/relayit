import { channelCredentialsSchema } from "@repo/api/channels/base";
import * as z from "zod";

export const adminProviderVendorParamsSchema = z.object({
  vendorId: z.string().min(1),
  productId: z.string().min(1),
});

export const adminProviderIdParamsSchema = z.object({
  providerId: z.string().min(1),
});

export const createAdminProviderBodySchema = z.object({
  name: z
    .string()
    .nullable()
    .transform((val) => {
      if (!val || val.trim() === "") {
        return null;
      }
      return val;
    }),
  credentials: channelCredentialsSchema,
  /** When true, becomes the default for Domain create when providerId is omitted. */
  isDefault: z.boolean().optional(),
});

export const updateAdminProviderBodySchema = z.object({
  name: z
    .string()
    .nullable()
    .optional()
    .transform((val) => {
      if (val === undefined) {
        return val;
      }
      if (!val || val.trim() === "") {
        return null;
      }
      return val;
    }),
  credentials: channelCredentialsSchema.partial().optional(),
  isDefault: z.boolean().optional(),
});
