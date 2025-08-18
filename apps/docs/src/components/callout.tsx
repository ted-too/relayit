import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@repo/old-ui/components/shadcn/alert";
import { cn } from "@repo/old-ui/lib/utils";

export function Callout({
	title,
	children,
	icon,
	className,
	...props
}: React.ComponentProps<typeof Alert> & { icon?: React.ReactNode }) {
	return (
		<Alert
			className={cn(
				"md:-mx-4 mt-6 w-auto border-none bg-surface text-surface-foreground",
				className
			)}
			{...props}
		>
			{icon}
			{title && <AlertTitle>{title}</AlertTitle>}
			<AlertDescription className="text-card-foreground/80">
				{children}
			</AlertDescription>
		</Alert>
	);
}
