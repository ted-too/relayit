import { z } from "zod";

export const signUpSchema = z.object({
	name: z.string(),
	email: z.string().email(),
	password: z.string(),
});

export type SignUpRequest = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
	email: z.string().email(),
	password: z.string(),
	rememberMe: z.boolean().optional(),
});

export type SignInRequest = z.infer<typeof signInSchema>;
