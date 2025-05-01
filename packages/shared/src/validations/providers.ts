import { z } from "zod";
import type { ProviderType, ChannelType } from "@repo/shared";

export const awsCredentialsSchema = z.object({
	accessKeyId: z.string().min(1, "Access Key ID is required"),
	secretAccessKey: z.string().min(1, "Secret Access Key is required"),
	region: z.string().min(1, "Region is required"),
});

export const sesConfigSchema = z.object({
	providerType: z.literal("ses" as ProviderType),
	channelType: z.literal("email" as ChannelType),
	credentials: awsCredentialsSchema,
});

export const snsConfigSchema = z.object({
	providerType: z.literal("sns" as ProviderType),
	channelType: z.literal("sms" as ChannelType),
	credentials: awsCredentialsSchema,
});

export const providerConfigSchema = z.discriminatedUnion("providerType", [
	sesConfigSchema,
	snsConfigSchema,
]);

export const createProviderCredentialSchema = z.object({
	name: z.string().min(1, "Name is required"),
	slug: z
		.string()
		.regex(
			/^[a-zA-Z0-9-]+$/,
			"Only alphanumeric characters and hyphens are allowed",
		)
		.optional(),
	projectId: z.string().optional().nullable(),
	providerConfig: providerConfigSchema,
	isActive: z.boolean().optional().default(true),
});

export type CreateProviderCredentialInput = z.infer<
	typeof createProviderCredentialSchema
>;

export const updateProviderCredentialSchema =
	createProviderCredentialSchema.partial();

export type UpdateProviderCredentialInput = z.infer<
	typeof updateProviderCredentialSchema
>;

export const getProvidersQuerySchema = z
	.object({
		projectId: z.string().optional().nullable(),
	})
	.partial();

export type GetProvidersQueryInput = z.infer<typeof getProvidersQuerySchema>;
