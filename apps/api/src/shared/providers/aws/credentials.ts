import type { ChannelCredentialsSchema } from "@repo/api/channels/base";
import { dynamicFormFieldsRegistry } from "@repo/api/validators/shared";
import * as z from "zod";

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
  encrypted: z.object({
    accessKeyId: z.string().register(dynamicFormFieldsRegistry, {
      type: "password",
      title: "Access Key ID",
      description: "Get this from the IAM console",
      placeholder: "AKIA...",
      order: 2,
    }),
    secretAccessKey: z.string().register(dynamicFormFieldsRegistry, {
      type: "password",
      title: "Secret Access Key",
      description: "Get this from the IAM console",
      placeholder: "GnXg...",
      order: 3,
    }),
  }),
  unencrypted: z.object({
    region: z
      .enum(AWS_REGIONS, {
        message: "Invalid region",
      })
      .register(dynamicFormFieldsRegistry, {
        type: "select",
        title: "Region",
        order: 1,
      }),
  }),
}) satisfies ChannelCredentialsSchema;
