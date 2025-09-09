import { z } from "zod";

export const AWS_REGIONS = [
  // North America
  "us-east-1", // US East (N. Virginia)
  "us-east-2", // US East (Ohio)
  "us-west-1", // US West (N. California)
  "us-west-2", // US West (Oregon)
  "ca-central-1", // Canada (Central)
  "ca-west-1", // Canada West (Calgary)
  "mx-central-1", // Mexico (Central)

  // Europe
  "eu-west-1", // Europe (Ireland)
  "eu-central-1", // Europe (Frankfurt)
  "eu-central-2", // Europe (Zurich)
  "eu-west-2", // Europe (London)
  "eu-west-3", // Europe (Paris)
  "eu-north-1", // Europe (Stockholm)
  "eu-south-1", // Europe (Milan)
  "eu-south-2", // Europe (Spain)

  // Asia Pacific
  "ap-east-1", // Asia Pacific (Hong Kong)
  "ap-northeast-1", // Asia Pacific (Tokyo)
  "ap-northeast-2", // Asia Pacific (Seoul)
  "ap-northeast-3", // Asia Pacific (Osaka)
  "ap-south-1", // Asia Pacific (Mumbai)
  "ap-south-2", // Asia Pacific (Hyderabad)
  "ap-southeast-1", // Asia Pacific (Singapore)
  "ap-southeast-2", // Asia Pacific (Sydney)
  "ap-southeast-3", // Asia Pacific (Jakarta)
  "ap-southeast-4", // Asia Pacific (Melbourne)
  "ap-southeast-5", // Asia Pacific (Malaysia)
  "ap-southeast-7", // Asia Pacific (Thailand)

  // Middle East
  "il-central-1", // Israel (Tel Aviv)
  "me-central-1", // Middle East (UAE)
  "me-south-1", // Middle East (Bahrain)

  // Africa
  "af-south-1", // Africa (Cape Town)

  // South America
  "sa-east-1", // South America (São Paulo)
] as const;

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
  credentials: ProviderCredentials
): credentials is AWSProviderCredentials {
  return (
    "unencrypted" in credentials &&
    "region" in credentials.unencrypted &&
    "accessKeyId" in credentials &&
    "secretAccessKey" in credentials
  );
}

export function isWhatsappProviderCredentials(
  credentials: ProviderCredentials
): credentials is WhatsappProviderCredentials {
  return "accessToken" in credentials;
}

export function isDiscordProviderCredentials(
  credentials: ProviderCredentials
): credentials is DiscordProviderCredentials {
  return "clientId" in credentials && "clientSecret" in credentials;
}
