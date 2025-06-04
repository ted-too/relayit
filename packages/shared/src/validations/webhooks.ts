import { AVAILABLE_MESSAGE_STATUSES } from "@repo/shared";
import { z } from "zod/v4";

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
