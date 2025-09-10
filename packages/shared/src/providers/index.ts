import { AWS_PROVIDER_CONFIG } from "./aws";

export const PROVIDER_CONFIG = {
  aws: AWS_PROVIDER_CONFIG,
} as const;

export type ProviderType = keyof typeof PROVIDER_CONFIG;
export const AVAILABLE_PROVIDER_TYPES = Object.keys(PROVIDER_CONFIG) as [
  ProviderType,
  ...ProviderType[],
];

export {
  AVAILABLE_CHANNELS,
  type ChannelType,
  type GenericProviderConfig,
  type GenericProviderCredentials,
} from "./base";
