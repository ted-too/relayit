"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";

import { cn } from "@repo/ui/lib/utils";
import * as React from "react";

function Slider({
	className,
	defaultValue,
	value,
	min = 0,
	max = 100,
	showTooltip = false,
	tooltipContent,
	...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
	showTooltip?: boolean;
	tooltipContent?: (value: number) => React.ReactNode;
}) {
	const [internalValues, setInternalValues] = React.useState<number[]>(
		Array.isArray(value)
			? value
			: Array.isArray(defaultValue)
				? defaultValue
				: [min, max]
	);

	React.useEffect(() => {
		if (value !== undefined) {
			setInternalValues(Array.isArray(value) ? value : [value]);
		}
	}, [value]);

	const handleValueChange = (newValue: number[]) => {
		setInternalValues(newValue);
		props.onValueChange?.(newValue);
	};

	const [showTooltipState, setShowTooltipState] = React.useState(false);

	const handlePointerDown = () => {
		if (showTooltip) {
			setShowTooltipState(true);
		}
	};

	const handlePointerUp = React.useCallback(() => {
		if (showTooltip) {
			setShowTooltipState(false);
		}
	}, [showTooltip]);

	React.useEffect(() => {
		if (showTooltip) {
			document.addEventListener("pointerup", handlePointerUp);
			return () => {
				document.removeEventListener("pointerup", handlePointerUp);
			};
		}
	}, [showTooltip, handlePointerUp]);

	const renderThumb = (value: number) => {
		const thumb = (
			<SliderPrimitive.Thumb
				className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm outline-none ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50"
				data-slot="slider-thumb"
				onPointerDown={handlePointerDown}
			/>
		);

		if (!showTooltip) {
			return thumb;
		}

		return (
			<TooltipProvider>
				<Tooltip open={showTooltipState}>
					<TooltipTrigger asChild>{thumb}</TooltipTrigger>
					<TooltipContent
						className="px-2 py-1 text-xs"
						side={props.orientation === "vertical" ? "right" : "top"}
						sideOffset={8}
					>
						<p>{tooltipContent ? tooltipContent(value) : value}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	};

	return (
		<SliderPrimitive.Root
			className={cn(
				"relative flex w-full touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[disabled]:opacity-50",
				className
			)}
			data-slot="slider"
			defaultValue={defaultValue}
			max={max}
			min={min}
			onValueChange={handleValueChange}
			value={value}
			{...props}
		>
			<SliderPrimitive.Track
				className={cn(
					"relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-1.5"
				)}
				data-slot="slider-track"
			>
				<SliderPrimitive.Range
					className={cn(
						"absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
					)}
					data-slot="slider-range"
				/>
			</SliderPrimitive.Track>
			{Array.from({ length: internalValues.length }, (_, index) => (
				<React.Fragment key={index}>
					{renderThumb(internalValues[index])}
				</React.Fragment>
			))}
		</SliderPrimitive.Root>
	);
}

export { Slider };
