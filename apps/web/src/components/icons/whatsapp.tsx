import { svgStringToReact, type IconProps } from ".";
import { siWhatsapp } from "simple-icons";

export function Whatsapp({ className }: IconProps): React.ReactNode {
	return svgStringToReact(siWhatsapp.svg, className);
}
