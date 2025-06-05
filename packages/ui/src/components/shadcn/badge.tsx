import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@repo/ui/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center justify-center select-none rounded-sm border px-1.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow] [&>svg]:shrink-0 leading-normal",
	{
		variants: {
			variant: {
				default:
					"border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90 [&_div#dot]:text-primary-foreground",
				secondary:
					"border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90 [&_div#dot]:text-secondary-foreground",
				destructive:
					"border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [&_div#dot]:text-white",
				outline:
					"text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground [&_div#dot]:text-foreground",
				"light-positive":
					"border-transparent bg-green-100 text-green-800 [a&]:hover:bg-green-200/90 focus-visible:ring-green-200/20 dark:focus-visible:ring-green-200/40 [&_div#dot]:bg-green-500",
				"secondary-positive":
					"border-transparent bg-blue-100 text-blue-800 [a&]:hover:bg-blue-200/90 focus-visible:ring-blue-200/20 dark:focus-visible:ring-blue-200/40 [&_div#dot]:bg-blue-500",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant,
	asChild = false,
	children,
	dot = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { asChild?: boolean; dot?: boolean }) {
	const Comp = asChild ? Slot : "span";

	return (
		<Comp
			data-slot="badge"
			className={cn(badgeVariants({ variant }), dot && "gap-1.5", className)}
			{...props}
		>
			{dot && <div id="dot" className="w-1.5 h-1.5 rounded-full" />}
			{children}
		</Comp>
	);
}

export { Badge, badgeVariants };
