"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import { useMetaColor } from "@repo/ui/hooks/use-meta-color";
import { useTheme } from "next-themes";
import * as React from "react";

export function ModeSwitcher() {
	const { setTheme, resolvedTheme } = useTheme();
	const { setMetaColor, metaColor } = useMetaColor();

	React.useEffect(() => {
		setMetaColor(metaColor);
	}, [metaColor, setMetaColor]);

	const toggleTheme = React.useCallback(() => {
		setTheme(resolvedTheme === "dark" ? "light" : "dark");
	}, [resolvedTheme, setTheme]);

	return (
		<Button
			className="group/toggle extend-touch-target size-8"
			onClick={toggleTheme}
			size="icon"
			title="Toggle theme"
			variant="ghost"
		>
			<svg
				className="size-4.5"
				fill="none"
				height="24"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
				viewBox="0 0 24 24"
				width="24"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M0 0h24v24H0z" fill="none" stroke="none" />
				<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
				<path d="M12 3l0 18" />
				<path d="M12 9l4.65 -4.65" />
				<path d="M12 14.3l7.37 -7.37" />
				<path d="M12 19.6l8.85 -8.85" />
			</svg>
			<span className="sr-only">Toggle theme</span>
		</Button>
	);
}
