import z from "zod/v3"; // We will leave this as v3 for now see https://github.com/rhinobase/hono-openapi/issues/97
import {
	AVAILABLE_EMAIL_PROVIDER_TYPES,
	AVAILABLE_SMS_PROVIDER_TYPES,
	AVAILABLE_WHATSAPP_PROVIDER_TYPES,
	AVAILABLE_DISCORD_PROVIDER_TYPES,
	type ChannelType,
} from "../constants/providers";

// Email-specific payload schema
const emailPayloadSchema = z
	.object({
		subject: z.string().optional(),
		body: z.string(),
		type: z.enum(["text", "html"]).optional().default("text"),
	})
	.strict();

// SMS-specific payload schema
const smsPayloadSchema = z
	.object({
		body: z.string(),
		type: z.enum(["text"]).optional().default("text"),
		smsType: z.enum(["Promotional", "Transactional"]).optional(),
	})
	.strict();

// WhatsApp-specific payload schema (for future use)
const whatsappPayloadSchema = z
	.object({
		body: z.string(),
		type: z.enum(["text"]).optional().default("text"),
	})
	.strict();

// Discord-specific payload schema (for future use)
const discordPayloadSchema = z
	.object({
		body: z.string(),
		type: z.enum(["text", "html"]).optional().default("text"),
	})
	.strict();

// Discriminated union based on channel type with channel-specific provider types
export const sendMessageSchema = z.discriminatedUnion("channel", [
	z.object({
		channel: z.literal<ChannelType>("email"),
		providerType: z.enum(AVAILABLE_EMAIL_PROVIDER_TYPES).optional(),
		recipient: z.string(),
		payload: emailPayloadSchema,
		projectSlug: z.string(),
	}),
	z.object({
		channel: z.literal<ChannelType>("sms"),
		providerType: z.enum(AVAILABLE_SMS_PROVIDER_TYPES).optional(),
		recipient: z.string(),
		payload: smsPayloadSchema,
		projectSlug: z.string(),
	}),
	z.object({
		channel: z.literal<ChannelType>("whatsapp"),
		providerType: z.enum(AVAILABLE_WHATSAPP_PROVIDER_TYPES).optional(),
		recipient: z.string(),
		payload: whatsappPayloadSchema,
		projectSlug: z.string(),
	}),
	z.object({
		channel: z.literal<ChannelType>("discord"),
		providerType: z.enum(AVAILABLE_DISCORD_PROVIDER_TYPES).optional(),
		recipient: z.string(),
		payload: discordPayloadSchema,
		projectSlug: z.string(),
	}),
]);

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EmailPayload = z.infer<typeof emailPayloadSchema>;
export type SMSPayload = z.infer<typeof smsPayloadSchema>;
export type WhatsAppPayload = z.infer<typeof whatsappPayloadSchema>;
export type DiscordPayload = z.infer<typeof discordPayloadSchema>;

// Union type for just the payloads
export type SendMessagePayload =
	| EmailPayload
	| SMSPayload
	| WhatsAppPayload
	| DiscordPayload;
