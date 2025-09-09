import { cn } from "@repo/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("animate-pulse rounded-md bg-secondary", className)}
			data-slot="skeleton"
			{...props}
		/>
	);
}

export { Skeleton };
