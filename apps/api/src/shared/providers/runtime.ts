import { AWS_RUNTIME_PROVIDER_CONFIG } from "@repo/api/providers/aws/runtime";

export const RUNTIME_PROVIDER_REGISTRY = {
  [AWS_RUNTIME_PROVIDER_CONFIG.id]: AWS_RUNTIME_PROVIDER_CONFIG,
} as const;

export type RuntimeProviderType = keyof typeof RUNTIME_PROVIDER_REGISTRY;
