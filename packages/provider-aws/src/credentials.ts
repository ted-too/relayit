import { credentialFieldRegistry } from "@repo/channels/credential-fields";
import * as z from "zod";

export const AWS_REGIONS = [
  "af-south-1",
  "ap-east-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-7",
  "ca-central-1",
  "ca-west-1",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "mx-central-1",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
] as const;

export const awsCredentialsSchema = z.object({
  encrypted: z.object({
    accessKeyId: z.string().min(1).register(credentialFieldRegistry, {
      description: "Get this from the IAM console",
      order: 2,
      placeholder: "AKIA...",
      title: "Access Key ID",
      type: "password",
    }),
    secretAccessKey: z.string().min(1).register(credentialFieldRegistry, {
      description: "Get this from the IAM console",
      order: 3,
      placeholder: "GnXg...",
      title: "Secret Access Key",
      type: "password",
    }),
  }),
  unencrypted: z.object({
    region: z.enum(AWS_REGIONS).register(credentialFieldRegistry, {
      order: 1,
      title: "Region",
      type: "select",
    }),
  }),
});

export type AwsCredentials = z.infer<typeof awsCredentialsSchema>;
