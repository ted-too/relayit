import { TooltipPortal } from "@radix-ui/react-tooltip";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/old-ui/components/shadcn/tooltip";
import { cn } from "@repo/old-ui/lib/utils";
import { useEffect, useRef, useState } from "react";

type TextWithTooltipProps = {
	text: string | number;
	className?: string;
};

export function TextWithTooltip({ text, className }: TextWithTooltipProps) {
	const [isTruncated, setIsTruncated] = useState<boolean>(false);
	const textRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const checkTruncation = () => {
			if (textRef.current) {
				const { scrollWidth, clientWidth } = textRef.current;
				setIsTruncated(scrollWidth > clientWidth);
			}
		};

		const resizeObserver = new ResizeObserver(() => {
			checkTruncation();
		});

		if (textRef.current) {
			resizeObserver.observe(textRef.current);
		}

		checkTruncation();

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	return (
		<TooltipProvider delayDuration={100} disableHoverableContent>
			<Tooltip>
				<TooltipTrigger asChild disabled={!isTruncated}>
					<div
						className={cn(
							"truncate",
							!isTruncated && "pointer-events-none",
							className
						)}
						ref={textRef}
					>
						{text}
					</div>
				</TooltipTrigger>
				<TooltipPortal>
					<TooltipContent>{text}</TooltipContent>
				</TooltipPortal>
			</Tooltip>
		</TooltipProvider>
	);
}
