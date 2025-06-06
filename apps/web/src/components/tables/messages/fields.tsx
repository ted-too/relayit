"use client";

import type {
	DataTableFilterField,
	Option,
	SheetField,
} from "@/components/data-table/types";
import { cn } from "@repo/ui/lib/utils";
import type { Message } from "@repo/db";
import { format } from "date-fns";
import { TabsObjectView } from "../../data-table/cells/tabs-object-view";
import {
	AVAILABLE_MESSAGE_STATUSES,
	type MessageStatus,
} from "@repo/shared/constants/core";
import { getStatusColor } from "@/lib/colors";
import {
	AVAILABLE_CHANNELS,
	AVAILABLE_PROVIDER_TYPES,
} from "@repo/shared/constants/providers";

// instead of filterFields, maybe just 'fields' with a filterDisabled prop?
// that way, we could have 'message' or 'headers' field with label and value as well as type!
export const filterFields = [
	{
		label: "Created At",
		value: "createdAt",
		type: "timerange",
		defaultOpen: true,
		commandDisabled: true,
	},
	{
		label: "Status",
		value: "status",
		type: "checkbox",
		defaultOpen: true,
		options: AVAILABLE_MESSAGE_STATUSES.map((level) => ({
			label: level,
			value: level,
		})),
		component: (props: Option) => {
			// TODO: type `Option` with `options` values via Generics
			const value = props.value as MessageStatus;
			return (
				<div className="flex grow items-center gap-2 max-w-28 font-mono">
					<span className="capitalize min-w-16 text-foreground/70 group-hover:text-accent-foreground">
						{props.label}
					</span>
					<div className="flex items-center gap-2">
						<div
							className={cn(
								"h-2.5 w-2.5 rounded-[2px]",
								getStatusColor(value).bg,
							)}
						/>
						<span className="text-xs text-muted-foreground/70">{value}</span>
					</div>
				</div>
			);
		},
	},
	{
		label: "Recipient",
		value: "recipient",
		type: "input",
	},
	{
		label: "Channel",
		value: "channel",
		type: "checkbox",
		options: AVAILABLE_CHANNELS.map((channel) => ({
			label: channel,
			value: channel,
		})),
	},
	{
		label: "Provider",
		value: "providerType",
		type: "checkbox",
		options: AVAILABLE_PROVIDER_TYPES.map((provider) => ({
			label: provider,
			value: provider,
		})),
	},
] satisfies DataTableFilterField<Message>[];

export const sheetFields = [
	{
		id: "id",
		label: "Message ID",
		type: "readonly",
		skeletonClassName: "w-64",
	},
	{
		id: "createdAt",
		label: "Created At",
		type: "timerange",
		component: (props) =>
			format(new Date(props.createdAt), "LLL dd, y HH:mm:ss"),
		skeletonClassName: "w-36",
	},
	{
		id: "status",
		label: "Status",
		type: "checkbox",
		component: (props) => {
			return (
				<span className={cn("font-mono", getStatusColor(props.status).text)}>
					{props.status}
				</span>
			);
		},
		skeletonClassName: "w-12",
	},
	{
		id: "recipient",
		label: "Recipient",
		type: "input",
		condition: (props) => props.recipient !== undefined,
		skeletonClassName: "w-24",
	},
	{
		id: "channel",
		label: "Channel",
		type: "checkbox",
		skeletonClassName: "w-10",
	},
	{
		id: "providerType",
		label: "Provider",
		type: "checkbox",
		skeletonClassName: "w-10",
	},
	{
		id: "payload",
		label: "Payload",
		type: "readonly",
		component: (props) => {
			if (!props.payload) return null;
			return (
				// REMINDER: negative margin to make it look like the header is on the same level of the tab triggers
				<TabsObjectView data={props.payload} className="-mt-[22px]" />
			);
		},
		className: "flex-col items-start w-full gap-1",
	},
] satisfies SheetField<Message>[];
