"use client";

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentProps, UIEventHandler } from "react";

import { cn } from "@/lib/utils";

export interface ScrollAreaProps
	extends ComponentProps<typeof ScrollAreaPrimitive.Root> {
	onViewportScroll?: UIEventHandler<HTMLDivElement> | undefined;
}

function ScrollArea({
	className,
	children,
	onViewportScroll,
	...props
}: ScrollAreaProps) {
	return (
		<ScrollAreaPrimitive.Root
			className={cn("relative overflow-hidden", className)}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				onScroll={onViewportScroll}
				className="h-full w-full rounded-[inherit]"
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar />
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}

function ScrollBar({
	className,
	orientation = "vertical",
	...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			orientation={orientation}
			className={cn(
				"flex touch-none select-none transition-colors",
				orientation === "vertical" &&
					"h-full w-2 border-l border-l-transparent p-[1px]",
				orientation === "horizontal" &&
					"h-2 flex-col border-t border-t-transparent p-[1px]",
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	);
}

export { ScrollArea, ScrollBar };
