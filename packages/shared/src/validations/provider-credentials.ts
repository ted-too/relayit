import { z } from "zod";

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

// TODO: Make this a real schema
export const whatsappCredentialsSchema = z.object({
	accessToken: z.string().min(1, "Access Token is required"),
});

// TODO: Make this a real schema
export const discordCredentialsSchema = z.object({
	accessToken: z.string().min(1, "Access Token is required"),
}); 