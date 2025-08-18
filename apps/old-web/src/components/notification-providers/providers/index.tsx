import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/old-ui/components/shadcn/tooltip";
import {
	ConfigurationType,
	ConfiguredIndicator,
	type ConfiguredIndicatorProps,
} from "./configured-indicator";

export type NotificationProviderButtonProps = {
	configured?: ConfiguredIndicatorProps;
};

export function ButtonWrapper({
	children,
	configured,
}: {
	children: React.ReactNode;
	configured?: ConfiguredIndicatorProps;
}) {
	if (configured === undefined) {
		return children;
	}

	return (
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
	);
}

export * from "./discord";
export * from "./email";
export * from "./sms";
export * from "./whatsapp";
