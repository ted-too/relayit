import { siWhatsapp } from "simple-icons";
import { type IconProps, svgStringToReact } from ".";

export function Whatsapp({ className }: IconProps): React.ReactNode {
	return svgStringToReact(siWhatsapp.svg, className);
}
