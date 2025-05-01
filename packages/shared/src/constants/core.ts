export const AVAILABLE_MESSAGE_STATUSES = [
	"queued",
	"processing",
	"sent",
	"failed",
	"delivered",
] as const;

export const PROVIDER_CONFIG = {
	email: ["ses"],
	sms: ["sns"],
	whatsapp: ["default"],
	discord: ["default"],
} as const;

export type ChannelType = keyof typeof PROVIDER_CONFIG;

export const AVAILABLE_CHANNELS = Object.keys(PROVIDER_CONFIG) as [
	ChannelType,
	...ChannelType[],
];

export type ProviderType =
	(typeof PROVIDER_CONFIG)[keyof typeof PROVIDER_CONFIG][number];

export const AVAILABLE_PROVIDER_TYPES = [
	...new Set(Object.values(PROVIDER_CONFIG).flat()),
] as [ProviderType, ...ProviderType[]];
