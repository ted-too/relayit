"use client";

import { Button } from "@repo/old-ui/components/shadcn/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/old-ui/components/shadcn/tooltip";
import { useCopyToClipboard } from "@repo/old-ui/hooks/use-copy-to-clipboard";
import { composeRefs } from "@repo/old-ui/lib/compose-refs";
import { cn } from "@repo/old-ui/lib/utils";
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
		if (content) {
			copy(content);
		}
	};

	const ContainerComponent = variant === "no-button" ? "button" : "div";

	const Component = (
		<ContainerComponent
			className="group relative min-w-0 text-left"
			onClick={variant === "no-button" ? onClick : undefined}
		>
			<p
				className={cn("peer group-hover:underline", className)}
				ref={composeRefs(ref, innerRef)}
				{...props}
			>
				{children}
			</p>
			{variant === "default" && (
				<Button
					className={cn(
						"absolute h-6 w-6 opacity-0 focus:opacity-100 group-hover:opacity-100 peer-focus:opacity-100",
						align === "top" && "top-2",
						align === "horizontal" && "-translate-y-1/2 top-1/2",
						align === "bottom" && "bottom-2"
					)}
					onClick={onClick}
					size="icon"
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
					type="button"
					variant="outline"
				>
					{isCopied ? (
						<CheckIcon className="h-3 w-3" />
					) : (
						<CopyIcon className="h-3 w-3" />
					)}
				</Button>
			)}
		</ContainerComponent>
	);

	if (variant === "default") {
		return Component;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>{Component}</TooltipTrigger>
			<TooltipContent>
				<p>{isCopied ? "Copied" : "Copy to clipboard"}</p>
			</TooltipContent>
		</Tooltip>
	);
}
