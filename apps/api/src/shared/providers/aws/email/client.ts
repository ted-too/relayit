import type { ClientEmailRegistryConfig } from "@repo/api/channels/email/types";
import { awsCredentialsSchema } from "@repo/api/providers/aws/credentials";
import * as z from "zod";

const domainConfigSchema = z.object({
  dkimSelector: z.string().optional(),
});

export const SES_CLIENT_CONFIG = {
  id: "ses",
  type: "email",
  label: "SES",
  credentialsSchema: awsCredentialsSchema,
  domainConfigSchema,
} as const satisfies ClientEmailRegistryConfig;
