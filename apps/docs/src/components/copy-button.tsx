"use client";

import * as React from "react";
import { CheckIcon, ClipboardIcon } from "lucide-react";

import { type Event, trackEvent } from "@/lib/events";
import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";

export function copyToClipboardWithMeta(value: string, event?: Event) {
	navigator.clipboard.writeText(value);
	if (event) {
		trackEvent(event);
	}
}

export function CopyButton({
	value,
	className,
	variant = "ghost",
	relative = false,
	align = "top",
	event,
	offset = 3,
	style,
	...props
}: React.ComponentProps<typeof Button> & {
	value: string;
	event?: Event["name"];
	relative?: boolean;
	align?: "top" | "center" | "bottom";
	offset?: number;
}) {
	const [hasCopied, setHasCopied] = React.useState(false);

	React.useEffect(() => {
		setTimeout(() => {
			setHasCopied(false);
		}, 2000);
	}, []);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					data-slot="copy-button"
					size="icon"
					variant={variant}
					className={cn(
						"bg-code size-7 hover:opacity-100 focus-visible:opacity-100",
						!relative &&
							{
								top: "absolute top-3 right-2 z-10",
								center:
									"absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10",
								bottom: "absolute bottom-3 right-2 z-10",
							}[align],
						className,
					)}
					style={
						{
							...style,
							top:
								align === "top"
									? `calc(var(--spacing) * ${offset})`
									: undefined,
							bottom:
								align === "bottom"
									? `calc(var(--spacing) * ${offset})`
									: undefined,
						} as React.CSSProperties
					}
					onClick={() => {
						copyToClipboardWithMeta(
							value,
							event
								? {
										name: event,
										properties: {
											code: value,
										},
									}
								: undefined,
						);
						setHasCopied(true);
					}}
					{...props}
				>
					<span className="sr-only">Copy</span>
					{hasCopied ? <CheckIcon /> : <ClipboardIcon />}
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				{hasCopied ? "Copied" : "Copy to Clipboard"}
			</TooltipContent>
		</Tooltip>
	);
}
