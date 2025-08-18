"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { useCopyToClipboard } from "@repo/ui/hooks/use-copy-to-clipboard";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { cn } from "@repo/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import * as React from "react";

export function CopyToClipboardContainer({
	ref,
	children,
	className,
	align = "top",
	side = "right",
	sideOffset = 8,
	inset = "inside",
	variant = "default",
	...props
}: React.ComponentProps<"p"> & {
	align?: "top" | "horizontal" | "bottom";
	side?: "left" | "right";
	inset?: "inside" | "outside";
	variant?: "default" | "no-button";
	sideOffset?: number;
}) {
	const innerRef = React.useRef<HTMLParagraphElement>(null);
	const { copy, isCopied } = useCopyToClipboard();

	const onClick = () => {
		const content = innerRef.current?.textContent;
		if (content) copy(content);
	};

	const ContainerComponent = variant === "no-button" ? "button" : "div";

	const Component = (
		<ContainerComponent
			className="relative group text-left min-w-0"
			onClick={variant === "no-button" ? onClick : undefined}
		>
			<p
				ref={composeRefs(ref, innerRef)}
				className={cn("peer group-hover:underline", className)}
				{...props}
			>
				{children}
			</p>
			{variant === "default" && (
				<Button
					variant="outline"
					size="icon"
					onClick={onClick}
					type="button"
					className={cn(
						"absolute w-6 h-6 opacity-0 group-hover:opacity-100 peer-focus:opacity-100 focus:opacity-100",
						align === "top" && "top-2",
						align === "horizontal" && "top-1/2 -translate-y-1/2",
						align === "bottom" && "bottom-2",
					)}
					style={{
						left:
							side === "left"
								? inset === "inside"
									? sideOffset
									: -sideOffset
								: undefined,
						right:
							side === "right"
								? inset === "inside"
									? sideOffset
									: -sideOffset
								: undefined,
					}}
				>
					{!isCopied ? (
						<CopyIcon className="h-3 w-3" />
					) : (
						<CheckIcon className="h-3 w-3" />
					)}
				</Button>
			)}
		</ContainerComponent>
	);

	if (variant === "default") return Component;

	return (
		<Tooltip>
			<TooltipTrigger asChild>{Component}</TooltipTrigger>
			<TooltipContent>
				<p>{isCopied ? "Copied" : "Copy to clipboard"}</p>
			</TooltipContent>
		</Tooltip>
	);
}
