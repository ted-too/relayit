import { Card, CardContent } from "@repo/ui/components/shadcn/card";
import type { IconProps as TablerIconProps } from "@tabler/icons-react";
import type { IconProps } from "./icons";
import { cn } from "@repo/ui/lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { Badge } from "@repo/ui/components/shadcn/badge";

type Icon = (props: IconProps | TablerIconProps) => React.ReactNode;

export interface ChannelCardProps {
	name: string;
	description: string;
	providers: string[];
	Icon: Icon;
	status: "live" | "coming-soon";
	className?: {
		root?: string;
		icon?: string;
		iconContainer?: string;
	};
}

export function ChannelCard(props: ChannelCardProps) {
	return (
		<Card
			variant="shadow"
			className="group hover:shadow-md transition-all duration-200"
			wrapperProps={{
				className: "items-center flex-row",
			}}
		>
			<CardContent className="flex items-center p-4">
				<div className="flex items-center space-x-3 mr-4">
					<div
						className={cn(
							"w-10 h-10 rounded-lg flex items-center justify-center",
							props.className?.iconContainer,
						)}
					>
						<props.Icon
							className={cn("w-5 h-5 text-white", props.className?.icon)}
						/>
					</div>
					{/* Multiple providers indicator - only show if more than one provider */}
					{/* {props.providers.length > 1 && (
						<div className="w-10 h-10 bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center">
							<svg
								className="w-4 h-4 text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M12 6v6m0 0v6m0-6h6m-6 0H6"
								/>
							</svg>
						</div>
					)} */}
				</div>
				<div className="flex-1">
					<div className="flex items-center gap-2 mb-1">
						<h3 className="font-medium text-base">{props.name}</h3>
						<Badge
							variant={
								props.status === "live"
									? "light-positive"
									: "secondary-positive"
							}
							className="capitalize rounded-full"
							dot
						>
							{props.status.replaceAll("-", " ")}
						</Badge>
					</div>
					<Tooltip>
						<TooltipTrigger>
							<p className="text-[0.8rem] text-muted-foreground leading-tight">
								{props.description}
							</p>
						</TooltipTrigger>
						<TooltipContent>
							<p>{props.providers.join(", ")}</p>
						</TooltipContent>
					</Tooltip>
				</div>
			</CardContent>
		</Card>
	);
}
