"use client";

import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@repo/ui/components/shadcn/hover-card";
import { useCopyToClipboard } from "@repo/ui/hooks/use-copy-to-clipboard";
import { cn } from "@repo/ui/lib/utils";
import { UTCDate } from "@date-fns/utc";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { format, formatDistanceToNowStrict } from "date-fns";
import { CopyIcon, CheckIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

type HoverCardContentProps = ComponentPropsWithoutRef<typeof HoverCardContent>;

interface HoverCardTimestampProps {
	date: Date;
	side?: HoverCardContentProps["side"];
	sideOffset?: HoverCardContentProps["sideOffset"];
	align?: HoverCardContentProps["align"];
	alignOffset?: HoverCardContentProps["alignOffset"];
	className?: string;
}

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
		<HoverCard openDelay={0} closeDelay={0}>
			<HoverCardTrigger asChild>
				<div className={cn("font-mono whitespace-nowrap", className)}>
					{format(date, "LLL dd, y HH:mm:ss")}
				</div>
			</HoverCardTrigger>
			{/* REMINDER: allows us to port the content to the document.body, which is helpful when using opacity-50 on the row element */}
			<HoverCardPortal>
				<HoverCardContent
					className="p-2 w-auto z-10"
					{...{ side, align, alignOffset, sideOffset }}
				>
					<dl className="flex flex-col gap-1">
						<Row value={String(date.getTime())} label="Timestamp" />
						<Row
							value={format(new UTCDate(date), "LLL dd, y HH:mm:ss")}
							label="UTC"
						/>
						<Row value={format(date, "LLL dd, y HH:mm:ss")} label={timezone} />
						<Row
							value={formatDistanceToNowStrict(date, { addSuffix: true })}
							label="Relative"
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
			className="group flex gap-4 text-sm justify-between items-center"
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
			<dd className="font-mono truncate flex items-center gap-1">
				<span className="invisible group-hover:visible">
					{!isCopied ? (
						<CopyIcon className="h-3 w-3" />
					) : (
						<CheckIcon className="h-3 w-3" />
					)}
				</span>
				{value}
			</dd>
		</div>
	);
}
