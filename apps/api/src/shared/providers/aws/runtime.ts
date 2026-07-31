import type { ProviderRegistryConfig } from "@repo/api/providers/types";
import { AWS_CLIENT_PROVIDER_CONFIG } from "./client";
import { SES_RUNTIME_CONFIG } from "./email/runtime";

export const AWS_RUNTIME_PROVIDER_CONFIG = {
  id: AWS_CLIENT_PROVIDER_CONFIG.id,
  label: AWS_CLIENT_PROVIDER_CONFIG.label,
  products: {
    [SES_RUNTIME_CONFIG.id]: SES_RUNTIME_CONFIG,
  },
} as const satisfies ProviderRegistryConfig;
