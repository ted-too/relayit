import { z } from "zod";
import {
	type ChannelType,
	getProviderConfig,
	type ProviderType,
} from "../constants/providers";

export const sesProjectProviderConfigSchema = z.object({
	senderEmail: z.string(),
});

export type SESProjectProviderConfig = z.infer<
	typeof sesProjectProviderConfigSchema
>;

export const snsProjectProviderConfigSchema = z.object({
	senderId: z.string(),
});

export type SNSProjectProviderConfig = z.infer<
	typeof snsProjectProviderConfigSchema
>;

export type ProjectProviderConfig =
	| SESProjectProviderConfig
	| SNSProjectProviderConfig;

export function isSESProjectProviderConfig(
	config: ProjectProviderConfig,
): config is SESProjectProviderConfig {
	return "senderEmail" in config;
}

export function isSNSProjectProviderConfig(
	config: ProjectProviderConfig,
): config is SNSProjectProviderConfig {
	return "senderId" in config;
}

export const baseProjectProviderAssociationSchema = z.object({
	isActive: z.boolean().optional(),
});

export function createProjectProviderSchema(
	channelType: ChannelType,
	providerType: ProviderType,
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config)
		throw new Error(
			`Invalid provider configuration: ${channelType}/${providerType}`,
		);

	return baseProjectProviderAssociationSchema
		.extend({
			config: config.configSchema ?? z.null(),
		})
		.strict();
}

export function updateProjectProviderSchema(
	channelType: ChannelType,
	providerType: ProviderType,
	configPartial = true,
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config)
		throw new Error(
			`Invalid provider configuration: ${channelType}/${providerType}`,
		);

	// Get the base schema without one-time fields
	const baseUpdateSchema = baseProjectProviderAssociationSchema.partial();

	return baseUpdateSchema
		.merge(
			z.object({
				config: config.configSchema
					? configPartial
						? config.configSchema.partial()
						: config.configSchema
					: z.null(),
			}),
		)
		.strict();
}

export type UpdateProjectProviderConfig = z.infer<
	ReturnType<typeof updateProjectProviderSchema>
>;

export const getProjectProviderAssociationsQuerySchema = z
	.object({
		isActive: z.boolean().optional(),
	})
	.partial();

export type GetProjectProviderAssociationsQueryInput = z.infer<
	typeof getProjectProviderAssociationsQuerySchema
>;
