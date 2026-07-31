import * as z from "zod";

const FQDN_REGEX = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const createDomainBodySchema = z.object({
  fqdn: z
    .string()
    .min(1)
    .max(253)
    .transform((value) => value.trim().toLowerCase())
    .refine((value) => FQDN_REGEX.test(value), "Invalid FQDN"),
  /** Managed backend or Project BYO Provider. Omit → current default managed backend. */
  providerId: z.string().min(1).optional(),
});

export const domainIdParamsSchema = z.object({
  domainId: z.string().min(1),
});

export const addDomainProviderBodySchema = z.object({
  providerId: z.string().min(1),
});

export const domainProviderParamsSchema = z.object({
  domainId: z.string().min(1),
  providerId: z.string().min(1),
});

export const switchActiveProviderBodySchema = z.object({
  providerId: z.string().min(1),
});

export const updateFailoverBodySchema = z.object({
  failoverEligible: z.boolean().optional(),
  failoverPriority: z.number().int().min(0).optional(),
});

export const pauseDomainBodySchema = z.object({
  reason: z
    .enum(["bad_reputation", "manual_admin_pause"])
    .default("manual_admin_pause"),
});
