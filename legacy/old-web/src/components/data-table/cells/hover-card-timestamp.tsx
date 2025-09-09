"use client";

import { UTCDate } from "@date-fns/utc";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@repo/old-ui/components/shadcn/hover-card";
import { useCopyToClipboard } from "@repo/old-ui/hooks/use-copy-to-clipboard";
import { cn } from "@repo/old-ui/lib/utils";
import { format, formatDistanceToNowStrict } from "date-fns";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

type HoverCardContentProps = ComponentPropsWithoutRef<typeof HoverCardContent>;

type HoverCardTimestampProps = {
	date: Date;
	side?: HoverCardContentProps["side"];
	sideOffset?: HoverCardContentProps["sideOffset"];
	align?: HoverCardContentProps["align"];
	alignOffset?: HoverCardContentProps["alignOffset"];
	className?: string;
};

export function HoverCardTimestamp({
	date,
	side = "right",
	align = "start",
	alignOffset = -4,
	sideOffset,
	className,
}: HoverCardTimestampProps) {
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	return (
		<HoverCard closeDelay={0} openDelay={0}>
			<HoverCardTrigger asChild>
				<div className={cn("whitespace-nowrap font-mono", className)}>
					{format(date, "LLL dd, y HH:mm:ss")}
				</div>
			</HoverCardTrigger>
			{/* REMINDER: allows us to port the content to the document.body, which is helpful when using opacity-50 on the row element */}
			<HoverCardPortal>
				<HoverCardContent
					className="z-10 w-auto p-2"
					{...{ side, align, alignOffset, sideOffset }}
				>
					<dl className="flex flex-col gap-1">
						<Row label="Timestamp" value={String(date.getTime())} />
						<Row
							label="UTC"
							value={format(new UTCDate(date), "LLL dd, y HH:mm:ss")}
						/>
						<Row label={timezone} value={format(date, "LLL dd, y HH:mm:ss")} />
						<Row
							label="Relative"
							value={formatDistanceToNowStrict(date, { addSuffix: true })}
						/>
					</dl>
				</HoverCardContent>
			</HoverCardPortal>
		</HoverCard>
	);
}

function Row({ value, label }: { value: string; label: string }) {
	const { copy, isCopied } = useCopyToClipboard();

	return (
		<div
			className="group flex items-center justify-between gap-4 text-sm"
			onClick={(e) => {
				e.stopPropagation();
				copy(value);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					e.stopPropagation();
					copy(value);
				}
			}}
			role="button"
			tabIndex={0}
		>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="flex items-center gap-1 truncate font-mono">
				<span className="invisible group-hover:visible">
					{isCopied ? (
						<CheckIcon className="h-3 w-3" />
					) : (
						<CopyIcon className="h-3 w-3" />
					)}
				</span>
				{value}
			</dd>
		</div>
	);
}
