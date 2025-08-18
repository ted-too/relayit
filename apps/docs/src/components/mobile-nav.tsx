"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@repo/ui/components/shadcn/popover";
import { cn } from "@repo/ui/lib/utils";
import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { source } from "@/lib/source";

export function MobileNav({
	tree,
	items,
	className,
}: {
	tree: typeof source.pageTree;
	items: { href: string; label: string }[];
	className?: string;
}) {
	const [open, setOpen] = React.useState(false);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					className={cn(
						"extend-touch-target !p-0 h-8 touch-manipulation items-center justify-start gap-2.5 hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 active:bg-transparent dark:hover:bg-transparent",
						className
					)}
					variant="ghost"
				>
					<div className="relative flex h-8 w-4 items-center justify-center">
						<div className="relative size-4">
							<span
								className={cn(
									"absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100",
									open ? "-rotate-45 top-[0.4rem]" : "top-1"
								)}
							/>
							<span
								className={cn(
									"absolute left-0 block h-0.5 w-4 bg-foreground transition-all duration-100",
									open ? "top-[0.4rem] rotate-45" : "top-2.5"
								)}
							/>
						</div>
						<span className="sr-only">Toggle Menu</span>
					</div>
					<span className="flex h-8 items-center font-medium text-lg leading-none">
						Menu
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				alignOffset={-16}
				className="no-scrollbar h-(--radix-popper-available-height) w-(--radix-popper-available-width) overflow-y-auto rounded-none border-none bg-background/90 p-0 shadow-none backdrop-blur duration-100"
				side="bottom"
				sideOffset={14}
			>
				<div className="flex flex-col gap-12 overflow-auto px-6 py-6">
					<div className="flex flex-col gap-4">
						<div className="font-medium text-muted-foreground text-sm">
							Menu
						</div>
						<div className="flex flex-col gap-3">
							<MobileLink href="/" onOpenChange={setOpen}>
								Home
							</MobileLink>
							{items.map((item, index) => (
								<MobileLink href={item.href} key={index} onOpenChange={setOpen}>
									{item.label}
								</MobileLink>
							))}
						</div>
					</div>
					<div className="flex flex-col gap-8">
						{tree?.children?.map((group, index) => {
							if (group.type === "folder") {
								return (
									<div className="flex flex-col gap-4" key={index}>
										<div className="font-medium text-muted-foreground text-sm">
											{group.name}
										</div>
										<div className="flex flex-col gap-3">
											{group.children.map((item) => {
												if (item.type === "page") {
													return (
														<MobileLink
															href={item.url}
															key={`${item.url}-${index}`}
															onOpenChange={setOpen}
														>
															{item.name}
														</MobileLink>
													);
												}
											})}
										</div>
									</div>
								);
							}
						})}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function MobileLink({
	href,
	onOpenChange,
	className,
	children,
	...props
}: LinkProps & {
	onOpenChange?: (open: boolean) => void;
	children: React.ReactNode;
	className?: string;
}) {
	const router = useRouter();
	return (
		<Link
			className={cn("font-medium text-2xl", className)}
			href={href}
			onClick={() => {
				router.push(href.toString());
				onOpenChange?.(false);
			}}
			{...props}
		>
			{children}
		</Link>
	);
}
