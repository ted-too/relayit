import type { ChannelType, MessageStatus, ProviderType } from "@repo/shared";
import {
	AVAILABLE_CHANNELS,
	AVAILABLE_MESSAGE_STATUSES,
	AVAILABLE_PROVIDER_TYPES,
} from "@repo/shared";
import {
	parseAsArrayOf,
	parseAsInteger,
	parseAsString,
	parseAsStringEnum,
} from "nuqs";

// TODO: Create a fn to take zod schema and return the parsers

export const basePaginationParsers = {
	start: parseAsInteger,
	end: parseAsInteger,
	id: parseAsArrayOf(parseAsString),
	sort: parseAsArrayOf(parseAsString), // will be in the format of <column_id>.<asc|desc>
};

export type BasePaginationParsers = typeof basePaginationParsers;

export const messageFilterParsers = {
	recipient: parseAsString,
	status: parseAsArrayOf(
		parseAsStringEnum<MessageStatus>([...AVAILABLE_MESSAGE_STATUSES])
	),
	channel: parseAsArrayOf(parseAsStringEnum<ChannelType>(AVAILABLE_CHANNELS)),
	provider: parseAsArrayOf(
		parseAsStringEnum<ProviderType>(AVAILABLE_PROVIDER_TYPES)
	),
};

export const messagesQueryParsers = {
	...basePaginationParsers,
	...messageFilterParsers,
};
