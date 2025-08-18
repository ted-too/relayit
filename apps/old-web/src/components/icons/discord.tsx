import { siDiscord } from "simple-icons";
import { type IconProps, svgStringToReact } from ".";

export function Discord({ className }: IconProps): React.ReactNode {
	return svgStringToReact(siDiscord.svg, className);
}
