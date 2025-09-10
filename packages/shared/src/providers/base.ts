import { z } from "zod";

export const AVAILABLE_CHANNELS = [
  "email",
  // "sms",
  // "whatsapp",
  // "discord",
] as const;

export type ChannelType = (typeof AVAILABLE_CHANNELS)[number];

export function buildCredentialSchema<
  T extends z.ZodType,
  R extends z.ZodType,
>({ encrypted, unencrypted }: { encrypted: T; unencrypted: R }) {
  return z.object({
    encrypted,
    unencrypted,
  });
}

export type GenericProviderConfig = {
  credentialsSchema: ReturnType<
    typeof buildCredentialSchema<z.ZodType, z.ZodType>
  >;
  channels: Partial<
    Record<
      ChannelType,
      {
        id: string;
      }
    >
  >;
};

export type GenericProviderCredentials = z.infer<
  GenericProviderConfig["credentialsSchema"]
>;
