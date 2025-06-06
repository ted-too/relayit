import { z } from "zod/v4";

export const AWS_REGIONS = ["us-east-1", "us-east-2", "us-west-2"] as const;

export const awsCredentialsSchema = z.object({
	unencrypted: z.object({
		region: z.enum(AWS_REGIONS, {
			message: "Invalid region",
		}),
	}),
	accessKeyId: z.string().min(1, "Access Key ID is required"),
	secretAccessKey: z.string().min(1, "Secret Access Key is required"),
});

export type AWSProviderCredentials = z.infer<typeof awsCredentialsSchema>;

export const whatsappCredentialsSchema = z.object({
	accessToken: z.string().min(1, "Access Token is required"),
});

export type WhatsappProviderCredentials = z.infer<
	typeof whatsappCredentialsSchema
>;

export const discordCredentialsSchema = z.object({
	clientId: z.string().min(1, "Client ID is required"),
	clientSecret: z.string().min(1, "Client Secret is required"),
});

export type DiscordProviderCredentials = z.infer<
	typeof discordCredentialsSchema
>;

export type ProviderCredentials =
	| AWSProviderCredentials
	| WhatsappProviderCredentials
	| DiscordProviderCredentials;

export function isAWSProviderCredentials(
	credentials: ProviderCredentials,
): credentials is AWSProviderCredentials {
	return (
		"unencrypted" in credentials &&
		"region" in credentials.unencrypted &&
		"accessKeyId" in credentials &&
		"secretAccessKey" in credentials
	);
}

export function isWhatsappProviderCredentials(
	credentials: ProviderCredentials,
): credentials is WhatsappProviderCredentials {
	return "accessToken" in credentials;
}

export function isDiscordProviderCredentials(
	credentials: ProviderCredentials,
): credentials is DiscordProviderCredentials {
	return "clientId" in credentials && "clientSecret" in credentials;
}
