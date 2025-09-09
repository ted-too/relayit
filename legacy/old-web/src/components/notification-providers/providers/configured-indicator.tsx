import { cn } from "@repo/old-ui/lib/utils";
import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";

export type ConfiguredIndicatorType =
	| "default"
	| "project-specific"
	| "not-configured";

export const ConfigurationType: Record<ConfiguredIndicatorType, string> = {
	default: "Provider found but not configured",
	"project-specific": "Provider configured for this project",
	"not-configured": "No provider found",
};

export type ConfiguredIndicatorProps = {
	configured: ConfiguredIndicatorType;
	className?: string;
};

export function ConfiguredIndicator({
	configured,
	className,
}: ConfiguredIndicatorProps) {
	if (configured === "project-specific") {
		return (
			<CircleCheckIcon
				className={cn(
					"-top-2 -right-2 absolute size-4 fill-current stroke-background text-green-500",
					className
				)}
			/>
		);
	}

	if (configured === "default") {
		return (
			<CircleAlertIcon
				className={cn(
					"-top-2 -right-2 absolute size-4 fill-current stroke-background text-orange-500",
					className
				)}
			/>
		);
	}

	return (
		<CircleXIcon
			className={cn(
				"-top-2 -right-2 absolute size-4 fill-current stroke-background text-red-500",
				className
			)}
		/>
	);
}
