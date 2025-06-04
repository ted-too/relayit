// Copy Pasta from: https://github.com/sadmann7/shadcn-table/blob/main/src/components/kbd.tsx#L54
import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

export const kbdVariants = cva(
	"select-none rounded border px-1.5 py-px font-mono text-[0.7rem] font-normal font-mono shadow-sm disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "bg-accent text-accent-foreground",
				outline: "bg-background text-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

interface BaseKbdProps
	extends React.ComponentPropsWithoutRef<"kbd">,
		VariantProps<typeof kbdVariants> {
	/**
	 * The title of the `abbr` element inside the `kbd` element.
	 * @default undefined
	 * @type string | undefined
	 * @example title="Command"
	 */
	abbrTitle?: string;
}

type KbdProps =
	| (Omit<BaseKbdProps, "children"> & {
			shortcut: string;
			children?: null;
	  })
	| (Omit<BaseKbdProps, "children"> & {
			shortcut?: null;
			children: React.ReactNode;
	  });

function Kbd({
	abbrTitle,
	children,
	className,
	variant,
	shortcut,
	...props
}: KbdProps) {
	const text = shortcut
		? shortcut
				.split("+")
				.map((s) => {
					const v = s.replace("Meta", "⌘");
					if (v.length > 1) return v;
					return v.toUpperCase();
				})
				.map((v) => (
					<span className="not-last:mr-1" key={v}>
						{v}
					</span>
				))
		: children;

	return (
		<kbd className={cn(kbdVariants({ variant, className }))} {...props}>
			{abbrTitle ? (
				<abbr title={abbrTitle} className="no-underline">
					{text}
				</abbr>
			) : (
				text
			)}
		</kbd>
	);
}

export { Kbd };
