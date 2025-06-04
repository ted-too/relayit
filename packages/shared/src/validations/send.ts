import { AVAILABLE_CHANNELS, AVAILABLE_PROVIDER_TYPES } from "@repo/shared";
import z from "zod/v4";

const payloadSchema = z
	.object({
		subject: z.string().optional(),
		body: z.string(),
		type: z.enum(["text", "html"]).optional().default("text"),
	})
	.strict();

export type SendMessagePayload = z.infer<typeof payloadSchema>;

export const sendMessageSchema = z.object({
	channel: z.enum(AVAILABLE_CHANNELS),
	providerType: z.enum(AVAILABLE_PROVIDER_TYPES).optional(),
	recipient: z.string(),
	payload: payloadSchema,
	projectSlug: z.string(),
});
