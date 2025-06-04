import type { z } from "zod/v4";
import {
	sesProjectProviderConfigSchema,
	snsProjectProviderConfigSchema,
} from "../validations/project-provider";
import {
	awsCredentialsSchema,
	discordCredentialsSchema,
	whatsappCredentialsSchema,
} from "../validations/provider-credentials";

export const PROVIDER_CONFIG = {
	email: [
		{
			type: "ses",
			label: "AWS SES",
			credentialsSchema: awsCredentialsSchema,
			configSchema: sesProjectProviderConfigSchema,
			oneTimeFields: {
				unencrypted: {
					region: true,
				},
			} satisfies OneTimeFieldsFromSchema<typeof awsCredentialsSchema>,
		},
	],
	sms: [
		{
			type: "sns",
			label: "AWS SNS",
			credentialsSchema: awsCredentialsSchema,
			configSchema: snsProjectProviderConfigSchema,
			oneTimeFields: {
				unencrypted: {
					region: true,
				},
			} satisfies OneTimeFieldsFromSchema<typeof awsCredentialsSchema>,
		},
	],
	whatsapp: [
		{
			type: "default",
			label: "WhatsApp",
			credentialsSchema: whatsappCredentialsSchema,
			configSchema: null,
			oneTimeFields: {
				accessToken: true,
			} satisfies OneTimeFieldsFromSchema<typeof whatsappCredentialsSchema>,
		},
	],
	discord: [
		{
			type: "default",
			label: "Discord",
			credentialsSchema: discordCredentialsSchema,
			configSchema: null,
			oneTimeFields: {
				accessToken: true,
			} satisfies OneTimeFieldsFromSchema<typeof discordCredentialsSchema>,
		},
	],
} as const;

export function getProviderConfig(
	channelType: ChannelType,
	providerType: ProviderType,
) {
	return PROVIDER_CONFIG[channelType].find((p) => p.type === providerType);
}

export type ChannelType = keyof typeof PROVIDER_CONFIG;

export const AVAILABLE_CHANNELS = Object.keys(PROVIDER_CONFIG) as [
	ChannelType,
	...ChannelType[],
];

export type ProviderType =
	(typeof PROVIDER_CONFIG)[keyof typeof PROVIDER_CONFIG][number]["type"];

export const AVAILABLE_PROVIDER_TYPES = [
	...new Set(
		Object.values(PROVIDER_CONFIG).flatMap((providers) =>
			providers.map((provider) => provider.type),
		),
	),
] as [ProviderType, ...ProviderType[]];

// Helper type to get nested object structure from a type
type NestedPaths<T> = T extends object
	? {
			[K in keyof T]?: T[K] extends object
				? boolean | NestedPaths<T[K]>
				: boolean;
		}
	: never;

// Get the inferred type from a Zod schema
type ZodInfer<T> = T extends z.ZodType<infer U> ? U : never;

// Type for oneTimeFields that matches the schema structure
type OneTimeFieldsFromSchema<T extends z.ZodType> = NestedPaths<ZodInfer<T>>;
