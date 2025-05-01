import { svgStringToReact, type IconProps } from ".";
import { siDiscord } from "simple-icons";

export function Discord({ className }: IconProps): React.ReactNode {
	return svgStringToReact(siDiscord.svg, className);
}
