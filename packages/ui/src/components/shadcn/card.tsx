import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";
import { Fragment } from "react";

function Card({
	className,
	children,
	variant = "default",
	wrapperProps: rawWrapperProps,
	...props
}: React.ComponentProps<"div"> & {
	variant?: "default" | "shadow";
	wrapperProps?: React.ComponentProps<"div">;
}) {
	const { className: wrapperClassName, ...wrapperProps } =
		rawWrapperProps ?? {};

	const ChildrenWrapper =
		variant === "shadow"
			? ({ children }: { children: React.ReactNode }) => (
					<div
						{...wrapperProps}
						className={cn(
							"flex h-full w-full flex-col rounded-xl bg-background shadow-md",
							wrapperClassName
						)}
					>
						{children}
					</div>
				)
			: Fragment;

	return (
		<div
			className={cn(
				"w-full max-w-5xl rounded-xl border bg-card text-card-foreground shadow",
				variant === "shadow" && "border bg-sidebar p-2.5 pb-3 shadow-sm",
				className
			)}
			{...props}
		>
			<ChildrenWrapper>{children}</ChildrenWrapper>
		</div>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("flex flex-col space-y-1.5 p-6", className)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("font-semibold leading-none tracking-tight", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"col-start-2 row-span-2 row-start-1 self-start justify-self-end",
				className
			)}
			data-slot="card-action"
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("p-6 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div className={cn("flex items-center p-6 pt-0", className)} {...props} />
	);
}

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardDescription,
	CardContent,
	CardAction,
};
