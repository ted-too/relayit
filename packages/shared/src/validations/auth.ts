import {
	ORGANIZATION_LOGO_GRADIENTS,
	type OrganizationLogoGradientKey,
} from "@repo/shared";
import { z } from "zod/v4";

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

export const organizationMetadataSchema = z.object({
	logoBgKey: z.enum(
		Object.keys(ORGANIZATION_LOGO_GRADIENTS) as [
			OrganizationLogoGradientKey,
			...OrganizationLogoGradientKey[],
		],
	),
	logoEmoji: z.string(),
});

export type OrganizationMetadata = z.infer<typeof organizationMetadataSchema>;

export const createOrganizationSchema = z.object({
	name: z.string(),
	slug: z.string(),
	metadata: organizationMetadataSchema,
});

export type CreateOrganizationRequest = z.infer<
	typeof createOrganizationSchema
>;

export const createApiKeySchema = z.object({
	name: z.string(),
	expiresIn: z.number().optional(),
});

export type CreateApiKeyRequest = z.infer<typeof createApiKeySchema>;
