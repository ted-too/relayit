import { channelCredentialsSchema } from "@repo/api/channels/base";
import * as z from "zod";

export const providerVendorParamsSchema = z.object({
  vendorId: z.string().min(1),
  productId: z.string().min(1),
});

export const providerIdParamsSchema = z.object({
  providerId: z.string().min(1),
});

export const createProviderBodySchema = z.object({
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
});

export const updateProviderBodySchema = z.object({
  name: z
    .string()
    .nullable()
    .optional()
    .transform((val) => {
      if (val === undefined) {
        return;
      }
      if (!val || val.trim() === "") {
        return null;
      }
      return val;
    }),
  credentials: channelCredentialsSchema.partial().optional(),
});
