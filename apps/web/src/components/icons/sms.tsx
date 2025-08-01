import { cn } from "@repo/ui/lib/utils";
import type { IconProps } from ".";

export function Sms({ className, ...props }: IconProps): React.ReactNode {
	return (
		<svg
			width="24px"
			height="24px"
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			strokeWidth="1.5"
			className={cn("size-5", className)}
			{...props}
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M2.25 5C2.25 3.48122 3.48122 2.25 5 2.25H19C20.5188 2.25 21.75 3.48122 21.75 5V15C21.75 16.5188 20.5188 17.75 19 17.75H7.96125C7.58154 17.75 7.2224 17.9226 6.98516 18.2191L4.65418 21.1328C3.85702 22.1293 2.25 21.5657 2.25 20.2895V5Z"
				fill="currentColor"
			/>
		</svg>
	);
}
