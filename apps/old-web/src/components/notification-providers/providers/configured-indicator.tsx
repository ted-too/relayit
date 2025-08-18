import { cn } from "@repo/ui/lib/utils";
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

export interface ConfiguredIndicatorProps {
	configured: ConfiguredIndicatorType;
	className?: string;
}

export function ConfiguredIndicator({
	configured,
	className,
}: ConfiguredIndicatorProps) {
	if (configured === "project-specific")
		return (
			<CircleCheckIcon
				className={cn(
					"size-4 absolute -top-2 -right-2 text-green-500 fill-current stroke-background",
					className,
				)}
			/>
		);

	if (configured === "default")
		return (
			<CircleAlertIcon
				className={cn(
					"size-4 absolute -top-2 -right-2 text-orange-500 fill-current stroke-background",
					className,
				)}
			/>
		);

	return (
		<CircleXIcon
			className={cn(
				"size-4 absolute -top-2 -right-2 text-red-500 fill-current stroke-background",
				className,
			)}
		/>
	);
}
