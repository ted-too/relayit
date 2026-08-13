import { z } from "zod";

export const signUpBodySchema = z.object({
  name: z.string(),
  email: z.email(),
  password: z.string(),
});

export type SignUpBody = z.infer<typeof signUpBodySchema>;

export const signInBodySchema = z.object({
  email: z.email(),
  password: z.string(),
  rememberMe: z.boolean().optional(),
});

export type SignInBody = z.infer<typeof signInBodySchema>;
