import { Badge } from "@repo/old-ui/components/shadcn/badge";
import { Card, CardContent } from "@repo/old-ui/components/shadcn/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/old-ui/components/shadcn/tooltip";
import { cn } from "@repo/old-ui/lib/utils";
import type { IconProps as TablerIconProps } from "@tabler/icons-react";
import type { IconProps } from "./icons";

type Icon = (props: IconProps | TablerIconProps) => React.ReactNode;

export type ChannelCardProps = {
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
};

export function ChannelCard(props: ChannelCardProps) {
  return (
    <Card
      className="group transition-all duration-200 hover:shadow-md"
      variant="shadow"
      wrapperProps={{
        className: "items-center flex-row",
      }}
    >
      <CardContent className="flex items-center p-4">
        <div className="mr-4 flex items-center space-x-3">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              props.className?.iconContainer
            )}
          >
            <props.Icon
              className={cn("h-5 w-5 text-white", props.className?.icon)}
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
          <div className="mb-1 flex items-center gap-2">
            <h3 className="font-medium text-base">{props.name}</h3>
            <Badge
              className="rounded-full capitalize"
              dot
              variant={
                props.status === "live"
                  ? "light-positive"
                  : "secondary-positive"
              }
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
