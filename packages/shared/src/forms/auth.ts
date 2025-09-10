import { z } from "zod";

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
  name: z.string(),
});

export type CreateOrganizationRequest = z.infer<
  typeof createOrganizationSchema
>;
