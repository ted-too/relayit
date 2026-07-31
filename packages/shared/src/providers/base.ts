import { z } from "zod";
import type * as z4 from "zod/v4/core";

export const AVAILABLE_CHANNELS = [
  "email",
  // "sms",
  // "whatsapp",
  // "discord",
] as const;

export type ChannelType = (typeof AVAILABLE_CHANNELS)[number];

export function buildCredentialSchema<
  T extends z4.$ZodObject,
  R extends z4.$ZodObject,
>({ encrypted, unencrypted }: { encrypted: T; unencrypted: R }) {
  return z.object({
    encrypted,
    unencrypted,
  });
}

export interface GenericProviderChannelConfig {
  domainConfigSchema?: z4.$ZodType;
  label: string;
}

export interface GenericProviderConfig {
  channels: Partial<Record<ChannelType, GenericProviderChannelConfig>>;
  credentialsSchema: ReturnType<
    typeof buildCredentialSchema<z4.$ZodObject, z4.$ZodObject>
  >;
  label: string;
}

export type GenericProviderCredentials = z4.infer<
  GenericProviderConfig["credentialsSchema"]
>;
