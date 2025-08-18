import { z } from "zod/v4";
import {
	type ChannelType,
	getProviderConfig,
	type ProviderType,
} from "../constants/providers";
import { generateDefaultFromShape } from "./providers";

export const sesProjectProviderConfigSchema = z.object({
	senderEmail: z.string(),
});

export type SESProjectProviderConfig = z.infer<
	typeof sesProjectProviderConfigSchema
>;

export const snsProjectProviderConfigSchema = z.object({
	senderName: z.string(),
});

export const whatsappProjectProviderConfigSchema = z.object({
	phoneNumberId: z.string(),
});

export type WhatsAppProjectProviderConfig = z.infer<
	typeof whatsappProjectProviderConfigSchema
>;

export type SNSProjectProviderConfig = z.infer<
	typeof snsProjectProviderConfigSchema
>;

export type ProjectProviderConfig =
	| SESProjectProviderConfig
	| SNSProjectProviderConfig
	| WhatsAppProjectProviderConfig;

export function isSESProjectProviderConfig(
	config: ProjectProviderConfig
): config is SESProjectProviderConfig {
	return "senderEmail" in config;
}

export function isSNSProjectProviderConfig(
	config: ProjectProviderConfig
): config is SNSProjectProviderConfig {
	return "senderName" in config;
}

export function isWhatsAppProjectProviderConfig(
	config: ProjectProviderConfig
): config is WhatsAppProjectProviderConfig {
	return "phoneNumberId" in config;
}

export const baseProjectProviderAssociationSchema = z.object({
	priority: z.coerce.number().default(0),
});

export function createProjectProviderSchema(
	channelType: ChannelType,
	providerType: ProviderType
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config) {
		throw new Error(
			`Invalid provider configuration: ${channelType}/${providerType}`
		);
	}

	return baseProjectProviderAssociationSchema
		.extend({
			config: config.configSchema ?? z.null(),
		})
		.strict();
}

export function getProjectProviderDefaults(
	channelType: ChannelType,
	providerType: ProviderType
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config) {
		throw new Error(
			`No provider configuration found for channel: ${channelType} and type: ${providerType}`
		);
	}

	// Get the schema for this provider
	const schema = createProjectProviderSchema(channelType, providerType);
	const shape = schema.shape;

	return generateDefaultFromShape(shape) as z.infer<
		ReturnType<typeof createProjectProviderSchema>
	>;
}

export function updateProjectProviderSchema(
	channelType: ChannelType,
	providerType: ProviderType,
	configPartial = true
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config) {
		throw new Error(
			`Invalid provider configuration: ${channelType}/${providerType}`
		);
	}

	// This usually should not have one-time fields
	const baseUpdateSchema = baseProjectProviderAssociationSchema.partial();

	return baseUpdateSchema
		.merge(
			z.object({
				config: config.configSchema
					? configPartial
						? config.configSchema.partial()
						: config.configSchema
					: z.null(),
			})
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
