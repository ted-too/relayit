import { AWS_CLIENT_PROVIDER_CONFIG } from "@repo/api/providers/aws/client";

export const CLIENT_PROVIDER_REGISTRY = {
  [AWS_CLIENT_PROVIDER_CONFIG.id]: AWS_CLIENT_PROVIDER_CONFIG,
} as const;

export type ClientProviderType = keyof typeof CLIENT_PROVIDER_REGISTRY;

/**
 * A dotted `provider.product` key, e.g. `"aws.ses"`. Each variant is derived
 * from the registry so the union stays typesafe as providers/products change.
 */
export type ProductKey = {
  [P in ClientProviderType]: `${P & string}.${keyof (typeof CLIENT_PROVIDER_REGISTRY)[P]["products"] & string}`;
}[ClientProviderType];
