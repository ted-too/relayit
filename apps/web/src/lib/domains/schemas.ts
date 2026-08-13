import { z } from "zod";

const FQDN_REGEX = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const createCustomDomainFormSchema = z.object({
  fqdn: z
    .string()
    .min(1)
    .max(253)
    .transform((value) => value.trim().toLowerCase())
    .refine((value) => FQDN_REGEX.test(value), "Invalid FQDN"),
  providerId: z.string().min(1).optional(),
});

export const createCustomDomainInputSchema =
  createCustomDomainFormSchema.extend({
    orgSlug: z.string().min(1),
  });

export const customDomainIdInputSchema = z.object({
  customDomainId: z.string().min(1),
  orgSlug: z.string().min(1),
});

export const listCustomDomainsInputSchema = z.object({
  orgSlug: z.string().min(1),
});

export const listProjectProvidersInputSchema = z.object({
  orgSlug: z.string().min(1),
});

export type CreateCustomDomainFormValues = z.infer<
  typeof createCustomDomainFormSchema
>;
export type CreateCustomDomainInput = z.infer<
  typeof createCustomDomainInputSchema
>;
