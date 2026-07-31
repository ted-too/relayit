import type { ProviderRegistryConfig } from "@repo/api/providers/types";
import { SES_CLIENT_CONFIG } from "./email/client";

export const AWS_CLIENT_PROVIDER_CONFIG = {
  id: "aws",
  label: "AWS",
  products: {
    [SES_CLIENT_CONFIG.id]: SES_CLIENT_CONFIG,
  },
} as const satisfies ProviderRegistryConfig;
