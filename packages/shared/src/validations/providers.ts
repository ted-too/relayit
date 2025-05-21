import { z } from "zod";
import type { ProviderType, ChannelType } from "../constants/providers";
import { getProviderConfig } from "../constants/providers";

// Base schema for all providers
export const baseProviderSchema = z.object({
	name: z.string().min(1, "Name is required"),
	slug: z
		.string()
		.regex(
			/^[a-zA-Z0-9-]+$/,
			"Only alphanumeric characters and hyphens are allowed",
		)
		.optional(),
	isActive: z.boolean().optional(),
});

// Helper to create a provider config schema
export function createProviderSchema(
	channelType: ChannelType,
	providerType: ProviderType,
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config)
		throw new Error(
			`Invalid provider configuration: ${channelType}/${providerType}`,
		);

	return baseProviderSchema
		.extend({
			credentials: config.credentialsSchema,
			providerType: z.literal(providerType),
			channelType: z.literal(channelType),
		})
		.strict();
}

// Create an update schema that excludes one-time fields and makes all fields optional
export function updateProviderSchema(
	channelType: ChannelType,
	providerType: ProviderType,
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config)
		throw new Error(
			`Invalid provider configuration: ${channelType}/${providerType}`,
		);

	// Get the base schema without one-time fields
	const baseUpdateSchema = baseProviderSchema.partial();

	// Helper to check if a field path is one-time
	const isOneTimeField = (
		path: string[],
		obj: Record<string, any>,
	): boolean => {
		const [first, ...rest] = path;
		if (!first) return false;
		if (obj[first] === true) return true;
		if (typeof obj[first] === "object" && rest.length > 0) {
			return isOneTimeField(rest, obj[first]);
		}
		return false;
	};

	// Create a new credentials schema that filters out one-time fields
	const updateCredentialsSchema = config.credentialsSchema
		.partial()
		.transform((data, ctx) => {
			const result: Record<string, any> = {};

			for (const [key, value] of Object.entries(data)) {
				const path = key.split(".");
				if (!isOneTimeField(path, config.oneTimeFields)) {
					result[key] = value;
				} else {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Cannot update one-time field: ${key}`,
						path: [key],
					});
				}
			}

			return result;
		});

	return baseUpdateSchema
		.merge(
			z.object({
				credentials: updateCredentialsSchema.optional(),
				providerType: z.literal(providerType),
				channelType: z.literal(channelType),
			}),
		)
		.strict();
}

// Helper to generate default values for a provider schema
export function getProviderDefaults(
	channelType: ChannelType,
	providerType: ProviderType,
) {
	const config = getProviderConfig(channelType, providerType);
	if (!config) {
		throw new Error(
			`No provider configuration found for channel: ${channelType} and type: ${providerType}`,
		);
	}

	// Get the schema for this provider
	const schema = createProviderSchema(channelType, providerType);
	const shape = schema.shape;

	// Generate default values based on schema types
	const generateDefaultFromShape = (shape: z.ZodRawShape) => {
		const defaults: Record<string, any> = {};

		for (const [key, value] of Object.entries(shape)) {
			if (value instanceof z.ZodString) {
				defaults[key] = "";
			} else if (value instanceof z.ZodBoolean) {
				defaults[key] = true;
			} else if (value instanceof z.ZodEnum) {
				defaults[key] = value.options[0];
			} else if (value instanceof z.ZodObject) {
				defaults[key] = generateDefaultFromShape(value.shape);
			} else if (value instanceof z.ZodOptional) {
				// For optional fields, still provide a default
				const innerType = value._def.innerType;
				if (innerType instanceof z.ZodString) {
					defaults[key] = "";
				} else if (innerType instanceof z.ZodBoolean) {
					defaults[key] = true;
				} else if (innerType instanceof z.ZodEnum) {
					defaults[key] = innerType.options[0];
				} else if (innerType instanceof z.ZodObject) {
					defaults[key] = generateDefaultFromShape(innerType.shape);
				}
			}
		}

		return defaults;
	};

	return {
		...generateDefaultFromShape(shape),
		providerType,
		channelType,
		credentials: generateDefaultFromShape(config.credentialsSchema.shape),
	} as z.infer<ReturnType<typeof createProviderSchema>>;
}

// Export the CreateProviderInput type
export type CreateProviderInput = z.infer<
	ReturnType<typeof createProviderSchema>
>;

// Export the ProviderConfigInput type
export type ProviderConfigInput = {
	providerType: ProviderType;
	channelType: ChannelType;
	credentials: Record<string, any>;
};
