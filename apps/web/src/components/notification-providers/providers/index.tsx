import {
	ConfigurationType,
	ConfiguredIndicator,
	type ConfiguredIndicatorProps,
} from "./configured-indicator";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export interface NotificationProviderButtonProps {
	configured?: ConfiguredIndicatorProps;
}

export function ButtonWrapper({
	children,
	configured,
}: {
	children: React.ReactNode;
	configured?: ConfiguredIndicatorProps;
}) {
	if (configured === undefined) return children;

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<div className="relative">
						{children}
						<ConfiguredIndicator {...configured} />
					</div>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<p>{ConfigurationType[configured.configured]}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

export * from "./email";
export * from "./sms";
export * from "./whatsapp";
export * from "./discord";
