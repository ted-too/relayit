"use client";

import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { composeRefs } from "@/lib/compose-refs";
import { cn } from "@/lib/utils";
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
	...props
}: React.ComponentProps<"p"> & {
	align?: "top" | "horizontal" | "bottom";
	side?: "left" | "right";
	inset?: "inside" | "outside";
	sideOffset?: number;
}) {
	const innerRef = React.useRef<HTMLParagraphElement>(null);
	const { copy, isCopied } = useCopyToClipboard();

	const onClick = () => {
		const content = innerRef.current?.textContent;
		if (content) copy(content);
	};

	return (
		<div className="relative group text-left min-w-0">
			<p
				ref={composeRefs(ref, innerRef)}
				className={cn("peer", className)}
				{...props}
			>
				{children}
			</p>
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
		</div>
	);
}
