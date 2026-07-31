import { z } from "zod";
import { AVAILABLE_CHANNELS, type ChannelType } from "./base";
import { PROVIDER_CONFIG, type ProviderType } from "./config";

function channelDomainConfigUnion(
  channel: ChannelType
): z.ZodTypeAny | undefined {
  const schemas: z.ZodTypeAny[] = [];

  for (const providerConfig of Object.values(PROVIDER_CONFIG)) {
    const channelConfig = providerConfig.channels[channel];
    if (channelConfig?.domainConfigSchema) {
      schemas.push(channelConfig.domainConfigSchema);
    }
  }

  if (schemas.length === 0) {
    return;
  }

  if (schemas.length === 1) {
    return schemas[0];
  }

  return z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

const domainProviderDataShape = Object.fromEntries(
  AVAILABLE_CHANNELS.flatMap((channel) => {
    const schema = channelDomainConfigUnion(channel);
    if (!schema) {
      return [];
    }
    return [[channel, schema.optional()] as const];
  })
) as z.ZodRawShape;

/** Channel-keyed domain state stored on `domain.provider_data` (mirrors identity `channelData`) */
export const domainProviderDataSchema = z.object(domainProviderDataShape);

export type DomainProviderData = z.infer<typeof domainProviderDataSchema>;

export function getDomainConfigSchema(
  providerType: ProviderType,
  channel: ChannelType
): z.ZodTypeAny | undefined {
  return PROVIDER_CONFIG[providerType].channels[channel]?.domainConfigSchema;
}

/** Validate `providerData` for a domain tied to a specific provider credential */
export function parseDomainProviderData(
  providerType: ProviderType,
  channel: ChannelType,
  data: unknown
): DomainProviderData {
  const parsed = domainProviderDataSchema.parse(data);
  const channelSchema = getDomainConfigSchema(providerType, channel);

  if (channelSchema && parsed[channel] !== undefined) {
    channelSchema.parse(parsed[channel]);
  }

  return parsed;
}

export type InferChannelDomainConfig<
  P extends ProviderType,
  C extends ChannelType,
> =
  NonNullable<(typeof PROVIDER_CONFIG)[P]["channels"][C]> extends {
    domainConfigSchema: infer S extends z.ZodTypeAny;
  }
    ? z.infer<S>
    : never;
