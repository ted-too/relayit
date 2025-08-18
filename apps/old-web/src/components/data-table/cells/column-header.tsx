import {
	Button,
	type ButtonProps,
} from "@repo/old-ui/components/shadcn/button";
import { cn } from "@repo/old-ui/lib/utils";
import type { Column } from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

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
			className={cn(
				"flex h-7 w-full items-center justify-between gap-2 px-0 py-0 text-sm hover:border-transparent hover:bg-transparent [&_svg]:size-3",
				className
			)}
			onClick={() => {
				column.toggleSorting(undefined);
			}}
			size="sm"
			variant="ghost"
			{...props}
		>
			<span>{title}</span>
			<span className="flex flex-col">
				<ChevronUpIcon
					className={cn(
						"-mb-0.5 h-3 w-3",
						column.getIsSorted() === "asc"
							? "text-accent-foreground"
							: "text-muted-foreground"
					)}
				/>
				<ChevronDownIcon
					className={cn(
						"-mt-0.5 h-3 w-3",
						column.getIsSorted() === "desc"
							? "text-accent-foreground"
							: "text-muted-foreground"
					)}
				/>
			</span>
		</Button>
	);
}
