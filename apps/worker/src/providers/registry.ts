import type {
  ChannelType,
  PROVIDER_CONFIG,
  ProviderType,
} from "@repo/shared/providers";
import { sendSES } from "@/providers/aws/ses";
import type { SendMethod } from "@/providers/interface";

// Extract supported channels for each provider from their config
type ProviderSupportedChannels<T extends ProviderType> = keyof NonNullable<
  (typeof PROVIDER_CONFIG)[T]["channels"]
>;

type ProviderRegistryType = {
  [P in ProviderType]: {
    [C in ProviderSupportedChannels<P>]: C extends ChannelType
      ? SendMethod<C>
      : never;
  };
};

export const PROVIDER_REGISTRY = {
  aws: {
    email: sendSES,
  },
} as const satisfies ProviderRegistryType;
