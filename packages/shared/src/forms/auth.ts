import { z } from "zod";
import { safeString } from "./shared";

export const signUpSchema = z.object({
  name: z.string(),
  email: z.email(),
  password: z.string(),
});

export type SignUpRequest = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email(),
  password: z.string(),
  rememberMe: z.boolean().optional(),
});

export type SignInRequest = z.infer<typeof signInSchema>;

export const createOrganizationSchema = z.object({
  name: safeString,
});

export type CreateOrganizationRequest = z.infer<
  typeof createOrganizationSchema
>;

export const updateOrganizationSchema = z.object({
  logo: z.url().nullish(),
  name: safeString.optional(),
  slug: safeString.optional(),
});

export type UpdateOrganizationRequest = z.infer<
  typeof updateOrganizationSchema
>;

export const createApiKeySchema = z.object({
  name: safeString,
  expiresIn: z.number().optional(),
});

export type CreateApiKeyRequest = z.infer<typeof createApiKeySchema>;
