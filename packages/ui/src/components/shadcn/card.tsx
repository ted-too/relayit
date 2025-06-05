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
							"rounded-xl bg-background shadow-md flex flex-col w-full h-full",
							wrapperClassName,
						)}
					>
						{children}
					</div>
				)
			: Fragment;

	return (
		<div
			className={cn(
				"rounded-xl border bg-card text-card-foreground shadow max-w-5xl w-full",
				variant === "shadow" && "p-2.5 pb-3 bg-sidebar border shadow-sm",
				className,
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
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn(
				"col-start-2 row-span-2 row-start-1 self-start justify-self-end",
				className,
			)}
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
