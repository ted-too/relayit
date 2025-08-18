import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";

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
	if (!enabled) {
		return children;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span aria-disabled className="text-sidebar-foreground/50">
					{children}
				</span>
			</TooltipTrigger>
			<TooltipContent align={align} side={side}>
				Coming soon
			</TooltipContent>
		</Tooltip>
	);
}
