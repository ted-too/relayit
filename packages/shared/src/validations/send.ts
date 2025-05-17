import z from "zod";
import { AVAILABLE_CHANNELS } from "@repo/shared";

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
	recipient: z.string(),
	payload: payloadSchema,
	projectSlug: z.string(),
});
