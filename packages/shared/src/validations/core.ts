import { z } from "zod";
import { AVAILABLE_CHANNELS, AVAILABLE_MESSAGE_STATUSES } from "@repo/shared";

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
	providerType: z.enum(AVAILABLE_CHANNELS),
	credentials: z.record(z.string(), z.string(), {
		required_error: "Credentials are required",
	}),
	isActive: z.boolean().optional().default(true),
});

export type CreateProviderCredentialInput = z.infer<
	typeof createProviderCredentialSchema
>;

export const updateProviderCredentialSchema = createProviderCredentialSchema
	.omit({ providerType: true })
	.partial();

export type UpdateProviderCredentialInput = z.infer<
	typeof updateProviderCredentialSchema
>;

export const createWebhookEndpointSchema = z.object({
	url: z.string().url("Invalid URL format"),
	secret: z.string().optional(),
	eventTypes: z
		.array(z.enum(AVAILABLE_MESSAGE_STATUSES))
		.min(1, "At least one event type must be selected"),
	isActive: z.boolean().optional().default(true),
});

export type CreateWebhookEndpointInput = z.infer<
	typeof createWebhookEndpointSchema
>;

export const updateWebhookEndpointSchema =
	createWebhookEndpointSchema.partial();

export type UpdateWebhookEndpointInput = z.infer<
	typeof updateWebhookEndpointSchema
>;
