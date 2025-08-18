"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import { Kbd } from "@repo/ui/components/shadcn/kbd";
import { Separator } from "@repo/ui/components/shadcn/separator";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@repo/ui/components/shadcn/sheet";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { cn } from "@repo/ui/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useDataTable } from "@/components/data-table/provider";

export type DataTableSheetDetailsProps = {
	title?: string;
	titleClassName?: string;
	children?: ReactNode;
};

export function DataTableSheetDetails({
	title,
	titleClassName,
	children,
}: DataTableSheetDetailsProps) {
	const { table, rowSelection, isLoading } = useDataTable();

	const selectedRowKey = Object.keys(rowSelection)?.[0];

	const selectedRow = useMemo(() => {
		if (isLoading && !selectedRowKey) {
			return;
		}
		return table
			.getCoreRowModel()
			.flatRows.find((row) => row.id === selectedRowKey);
	}, [selectedRowKey, isLoading, table.getCoreRowModel]);

	const index = table
		.getCoreRowModel()
		.flatRows.findIndex((row) => row.id === selectedRow?.id);

	const nextId = useMemo(
		() => table.getCoreRowModel().flatRows[index + 1]?.id,
		[index, table.getCoreRowModel]
	);

	const prevId = useMemo(
		() => table.getCoreRowModel().flatRows[index - 1]?.id,
		[index, table.getCoreRowModel]
	);

	const onPrev = useCallback(() => {
		if (prevId) {
			table.setRowSelection({ [prevId]: true });
		}
	}, [prevId, table.setRowSelection]);

	const onNext = useCallback(() => {
		if (nextId) {
			table.setRowSelection({ [nextId]: true });
		}
	}, [nextId, table.setRowSelection]);

	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (!selectedRowKey) {
				return;
			}

			// REMINDER: prevent dropdown navigation inside of sheet to change row selection
			const activeElement = document.activeElement;
			const isMenuActive = activeElement?.closest('[role="menu"]');

			if (isMenuActive) {
				return;
			}

			if (e.key === "ArrowUp") {
				e.preventDefault();
				onPrev();
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				onNext();
			}
		};

		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, [selectedRowKey, onNext, onPrev]);

	return (
		<Sheet
			onOpenChange={() => {
				// REMINDER: focus back to the row that was selected
				// We need to manually focus back due to missing Trigger component
				const el = selectedRowKey
					? document.getElementById(selectedRowKey)
					: null;
				table.resetRowSelection();

				// REMINDER: when navigating between tabs in the sheet and exit the sheet, the tab gets lost
				// We need a minimal delay to allow the sheet to close before focusing back to the row
				setTimeout(() => el?.focus(), 0);
			}}
			open={!!selectedRowKey}
		>
			<SheetContent
				// onCloseAutoFocus={(e) => e.preventDefault()}
				className="overflow-y-auto p-0 sm:max-w-md"
				hideClose
			>
				<SheetHeader className="sticky top-0 z-10 border-b bg-background p-4">
					<div className="flex items-center justify-between gap-2">
						<SheetTitle className={cn(titleClassName, "truncate text-left")}>
							{isLoading && !selectedRowKey ? (
								<Skeleton className="h-7 w-36" />
							) : (
								title
							)}
						</SheetTitle>
						<div className="flex h-7 items-center gap-1">
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											className="h-7 w-7"
											disabled={!prevId}
											onClick={onPrev}
											size="icon"
											variant="ghost"
										>
											<ChevronUpIcon className="h-5 w-5" />
											<span className="sr-only">Previous</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Navigate <Kbd variant="outline">↑</Kbd>
										</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											className="h-7 w-7"
											disabled={!nextId}
											onClick={onNext}
											size="icon"
											variant="ghost"
										>
											<ChevronDownIcon className="h-5 w-5" />
											<span className="sr-only">Next</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Navigate <Kbd variant="outline">↓</Kbd>
										</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<Separator className="mx-1" orientation="vertical" />
							<SheetClose asChild autoFocus={true}>
								<Button className="h-7 w-7" size="icon" variant="ghost">
									<XIcon className="h-5 w-5" />
									<span className="sr-only">Close</span>
								</Button>
							</SheetClose>
						</div>
					</div>
				</SheetHeader>
				<SheetDescription className="sr-only">
					Selected row details
				</SheetDescription>
				<div className="p-4">{children}</div>
			</SheetContent>
		</Sheet>
	);
}
