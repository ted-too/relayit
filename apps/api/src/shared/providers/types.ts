import type { ChannelRegistryConfig } from "@repo/api/channels/base";
import type { ChannelType } from "@repo/api/db/schema/channels";

export interface ProviderRegistryConfig {
  id: string;
  label: string;
  products: Record<string, ChannelRegistryConfig<ChannelType>>;
}
