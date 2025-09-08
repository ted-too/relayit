/** biome-ignore-all lint/a11y/useButtonType: this is handled upstream */
import { mergeProps } from "@base-ui-components/react/merge-props";
import { useRender } from "@base-ui-components/react/use-render";
import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircleIcon } from "lucide-react";

const buttonVariants = cva(
	"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
				brand: "bg-brand text-primary-foreground shadow-xs hover:bg-brand/90",
				destructive:
					"bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
				outline:
					"border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
				secondary:
					"bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
				ghost:
					"hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
				"ghost-destructive":
					"hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
				xl: "h-10 rounded-md px-4 px-4 text-sm sm:px-6 sm:text-md sm:has-[>svg]:px-5 md:h-13 md:px-7 md:text-lg",
				icon: "size-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	}
);

export interface ButtonProps
	extends useRender.ComponentProps<"button">,
		VariantProps<typeof buttonVariants> {}

function Button({
	className,
	variant,
	size,
	render = <button />,
	...props
}: ButtonProps) {
	const defaultProps: useRender.ElementProps<"button"> = {
		className: cn(buttonVariants({ variant, size, className })),
		type: "button",
	};

	const element = useRender({
		render,
		props: mergeProps<"button">(defaultProps, props),
	});

	return element;
}

interface ActionButtonProps
	extends useRender.ComponentProps<"button">,
		VariantProps<typeof buttonVariants> {
	isLoading?: boolean;
	loaderClassName?: string;
}

function ActionButton({
	className,
	variant,
	size,
	isLoading = false,
	disabled = false,
	loaderClassName,
	children,
	render = <button />,
	...props
}: ActionButtonProps) {
	const defaultProps: useRender.ElementProps<"button"> = {
		className: cn(buttonVariants({ variant, size, className })),
		disabled: disabled || isLoading,
		type: "button",
		children: isLoading ? (
			<LoaderCircleIcon className={cn("animate-spin", loaderClassName)} />
		) : (
			children
		),
	};

	const element = useRender({
		render,
		props: mergeProps<"button">(defaultProps, props),
	});

	return element;
}

export { Button, ActionButton, buttonVariants };
