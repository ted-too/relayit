import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export function ComingSoon({
	children,
	enabled = true,
	side = "bottom",
	align = "center",
}: {
	children: React.ReactNode;
	enabled?: boolean;
	side?: React.ComponentProps<typeof TooltipContent>["side"];
	align?: React.ComponentProps<typeof TooltipContent>["align"];
}) {
	if (!enabled) return children;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="text-sidebar-foreground/50" aria-disabled>
					{children}
				</span>
			</TooltipTrigger>
			<TooltipContent side={side} align={align}>
				Coming soon
			</TooltipContent>
		</Tooltip>
	);
}
