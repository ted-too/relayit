import type { Column } from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button, type ButtonProps } from "@repo/ui/components/shadcn/button";
import { cn } from "@repo/ui/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue> extends ButtonProps {
	column: Column<TData, TValue>;
	title: string;
}

export function DataTableColumnHeader<TData, TValue>({
	column,
	title,
	className,
	...props
}: DataTableColumnHeaderProps<TData, TValue>) {
	if (!column.getCanSort()) {
		return <div className={cn(className)}>{title}</div>;
	}

	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => {
				column.toggleSorting(undefined);
			}}
			className={cn(
				"py-0 px-0 h-7 hover:bg-transparent hover:border-transparent text-sm flex gap-2 items-center justify-between w-full [&_svg]:size-3",
				className,
			)}
			{...props}
		>
			<span>{title}</span>
			<span className="flex flex-col">
				<ChevronUpIcon
					className={cn(
						"-mb-0.5 h-3 w-3",
						column.getIsSorted() === "asc"
							? "text-accent-foreground"
							: "text-muted-foreground",
					)}
				/>
				<ChevronDownIcon
					className={cn(
						"-mt-0.5 h-3 w-3",
						column.getIsSorted() === "desc"
							? "text-accent-foreground"
							: "text-muted-foreground",
					)}
				/>
			</span>
		</Button>
	);
}
