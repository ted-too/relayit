import { Slot } from "@radix-ui/react-slot";
import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 select-none items-center justify-center gap-1 whitespace-nowrap rounded-sm border px-1.5 font-medium text-xs leading-normal transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"border-transparent bg-primary text-primary-foreground [&_div#dot]:text-primary-foreground [a&]:hover:bg-primary/90",
				secondary:
					"border-transparent bg-secondary text-secondary-foreground [&_div#dot]:text-secondary-foreground [a&]:hover:bg-secondary/90",
				destructive:
					"border-transparent bg-destructive text-white focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [&_div#dot]:text-white [a&]:hover:bg-destructive/90",
				outline:
					"text-foreground [&_div#dot]:text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
				"light-positive":
					"border-transparent bg-green-100 text-green-800 focus-visible:ring-green-200/20 dark:focus-visible:ring-green-200/40 [&_div#dot]:bg-green-500 [a&]:hover:bg-green-200/90",
				"secondary-positive":
					"border-transparent bg-blue-100 text-blue-800 focus-visible:ring-blue-200/20 dark:focus-visible:ring-blue-200/40 [&_div#dot]:bg-blue-500 [a&]:hover:bg-blue-200/90",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	}
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
			className={cn(badgeVariants({ variant }), dot && "gap-1.5", className)}
			data-slot="badge"
			{...props}
		>
			{dot && <div className="h-1.5 w-1.5 rounded-full" id="dot" />}
			{children}
		</Comp>
	);
}

export { Badge, badgeVariants };
