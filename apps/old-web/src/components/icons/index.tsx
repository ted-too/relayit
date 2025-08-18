import { cn } from "@repo/ui/lib/utils";
import parse from "html-react-parser";
import type React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
	variant?: string;
}

const SVG_ATTRIBUTES_TO_REACT = {
	"fill-rule": "fillRule",
	"fill-opacity": "fillOpacity",
	"stroke-width": "strokeWidth",
	"stroke-linecap": "strokeLinecap",
	"stroke-linejoin": "strokeLinejoin",
	"stroke-miterlimit": "strokeMiterlimit",
	"stroke-dasharray": "strokeDasharray",
};

export const svgStringToReact = (svg: string, className?: string) =>
	parse(svg, {
		// @ts-expect-error this is not typed
		replace: ({ name, attribs }) => {
			if (attribs?.fill) {
				attribs.fill = "currentColor";
			}
			if (attribs?.stroke) {
				attribs.stroke = "currentColor";
			}
			if (name === "svg") {
				attribs.class = cn("stroke-current fill-current", className);
			}
			for (const [key, value] of Object.entries(SVG_ATTRIBUTES_TO_REACT)) {
				if (attribs?.[key]) {
					attribs[value] = attribs[key];
					delete attribs[key];
				}
			}
		},
	});

export * from "./email";
export * from "./sms";
export * from "./whatsapp";
export * from "./discord";
