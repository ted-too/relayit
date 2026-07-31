import * as z from "zod";
import type { ChannelType } from "../db/schema/channels";

export const channelCredentialsSchema = z.object({
  encrypted: z.looseObject({}),
  unencrypted: z.looseObject({}),
});

export type ChannelCredentialsSchema = typeof channelCredentialsSchema;

export type ChannelCredentials = z.infer<ChannelCredentialsSchema>;

export interface ChannelRegistryConfig<T extends ChannelType> {
  credentialsSchema: ChannelCredentialsSchema;
  id: string;
  label: string;
  type: T;
}
