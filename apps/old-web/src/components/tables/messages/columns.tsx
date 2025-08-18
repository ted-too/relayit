"use client";

import { TextWithTooltip } from "@/components/data-table/cells/text-with-tooltip";
import { DataTableColumnHeader } from "@/components/data-table/cells/column-header";
import type { Message } from "@repo/db";
import type { ColumnDef } from "@tanstack/react-table";
import { MinusIcon } from "lucide-react";
import { HoverCardTimestamp } from "@/components/data-table/cells/hover-card-timestamp";
import type { MessageStatus, SendMessagePayload } from "@repo/shared";
import { StatusIndicator } from "../../data-table/cells/status-indicator";
import { getStatusColor } from "@/lib/colors";

export const columns: ColumnDef<Message>[] = [
	{
		id: "status-label",
		accessorKey: "status",
		header: "",
		cell: ({ row }) => {
			const value = row.getValue("status") as MessageStatus;
			return <StatusIndicator status={value} />;
		},
		enableHiding: false,
		enableResizing: false,
		filterFn: "arrSome",
		size: 27,
		minSize: 27,
		maxSize: 27,
		meta: {
			headerClassName:
				"w-(--header-status-label-size) max-w-(--header-status-label-size) min-w-(--header-status-label-size)",
			cellClassName:
				"w-(--col-status-label-size) max-w-(--col-status-label-size) min-w-(--col-status-label-size)",
		},
	},
	{
		accessorKey: "createdAt",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Created At" />
		),
		cell: ({ row }) => {
			const date = new Date(row.getValue("createdAt"));
			return <HoverCardTimestamp date={date} />;
		},
		filterFn: "inDateRange",
		enableResizing: false,
		size: 200,
		minSize: 200,
		meta: {
			headerClassName:
				"w-(--header-createdAt-size) max-w-(--header-createdAt-size) min-w-(--header-createdAt-size)",
			cellClassName:
				"font-mono w-(--col-createdAt-size) max-w-(--col-createdAt-size) min-w-(--col-createdAt-size)",
		},
	},
	{
		accessorKey: "id",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Message Id" />
		),
		cell: ({ row }) => {
			const value = row.getValue("id") as string;
			return <TextWithTooltip text={value} />;
		},
		size: 130,
		minSize: 130,
		enableSorting: false,
		meta: {
			label: "Message Id",
			cellClassName:
				"font-mono w-(--col-id-size) max-w-(--col-id-size) min-w-(--col-id-size)",
			headerClassName:
				"min-w-(--header-id-size) w-(--header-id-size) max-w-(--header-id-size)",
		},
	},
	{
		id: "status",
		accessorKey: "status",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Status" />
		),
		cell: ({ row }) => {
			const value = row.getValue("status") as undefined | MessageStatus;
			if (value === undefined) {
				return <MinusIcon className="h-4 w-4 text-muted-foreground/50" />;
			}
			const colors = getStatusColor(value);
			return <span className={`${colors.text} font-mono`}>{value}</span>;
		},
		filterFn: "arrSome",
		enableResizing: false,
		size: 60,
		minSize: 60,
		meta: {
			headerClassName:
				"w-(--header-status-size) max-w-(--header-status-size) min-w-(--header-status-size)",
			cellClassName:
				"font-mono w-(--col-status-size) max-w-(--col-status-size) min-w-(--col-status-size)",
		},
	},
	{
		accessorKey: "payload",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Payload" />
		),
		cell: ({ row }) => {
			const value = row.getValue("payload") as SendMessagePayload;
			return <TextWithTooltip text={JSON.stringify(value)} />;
		},
		filterFn: "includesString",
		enableSorting: false,
		size: 120,
		minSize: 120,
		meta: {
			cellClassName:
				"font-mono text-muted-foreground w-(--col-payload-size) max-w-(--col-payload-size) min-w-(--col-payload-size)",
			headerClassName:
				"w-(--header-payload-size) max-w-(--header-payload-size) min-w-(--header-payload-size)",
		},
	},
	{
		accessorKey: "recipient",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Recipient" />
		),
		enableSorting: false,
		size: 69,
		minSize: 69,
		meta: {
			cellClassName:
				"font-mono w-(--col-recipient-size) max-w-(--col-recipient-size)",
			headerClassName:
				"min-w-(--header-recipient-size) w-(--header-recipient-size)",
		},
	},
	{
		accessorKey: "channel",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Channel" />
		),
		enableSorting: true,
		size: 69,
		minSize: 69,
		meta: {
			cellClassName:
				"font-mono w-(--col-channel-size) max-w-(--col-channel-size)",
			headerClassName:
				"min-w-(--header-channel-size) w-(--header-channel-size)",
		},
	},
	{
		accessorKey: "providerType",
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Provider" />
		),
		enableSorting: true,
		size: 69,
		minSize: 69,
		meta: {
			cellClassName:
				"font-mono w-(--col-providerType-size) max-w-(--col-providerType-size)",
			headerClassName:
				"min-w-(--header-providerType-size) w-(--header-providerType-size)",
		},
	},
	{
		id: "project",
		accessorFn: (row) => row.project.name,
		header: ({ column }) => (
			<DataTableColumnHeader column={column} title="Project" />
		),
		enableSorting: false,
		size: 69,
		minSize: 69,
		meta: {
			cellClassName:
				"font-mono w-(--col-project-size) max-w-(--col-project-size)",
			headerClassName:
				"min-w-(--header-project-size) w-(--header-project-size)",
		},
	},
];
