import { DropdownMenu } from "@/components/ui/dropdown-menu";
import {
	DropdownMenuContent,
	DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { DataTableFilterField } from "@/components/data-table/types";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import type { Table } from "@tanstack/react-table";
import { startOfDay } from "date-fns";
import { startOfHour } from "date-fns";
import { endOfDay } from "date-fns";
import { endOfHour } from "date-fns";
import {
	CopyIcon,
	CalendarSearchIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	EqualIcon,
	SearchIcon,
} from "lucide-react";
import { CalendarDaysIcon, CalendarClockIcon } from "lucide-react";

interface DataTableSheetRowActionProps<
	TData,
	TFields extends DataTableFilterField<TData>,
> extends React.ComponentPropsWithRef<typeof DropdownMenuTrigger> {
	fieldValue: TFields["value"];
	filterFields: TFields[];
	value: string | number;
	table: Table<TData>;
}

export function DataTableSheetRowAction<
	TData,
	TFields extends DataTableFilterField<TData>,
>({
	fieldValue,
	filterFields,
	value,
	children,
	className,
	table,
	onKeyDown,
	...props
}: DataTableSheetRowActionProps<TData, TFields>) {
	const { copy, isCopied } = useCopyToClipboard();
	const field = filterFields.find((field) => field.value === fieldValue);
	const column = table.getColumn(fieldValue.toString());

	if (!field || !column) return null;

	function renderOptions() {
		if (!field) return null;
		switch (field.type) {
			case "checkbox":
				return (
					<DropdownMenuItem
						onClick={() => {
							// FIXME:
							const filterValue = column?.getFilterValue() as
								| undefined
								| Array<unknown>;
							const newValue = filterValue?.includes(value)
								? filterValue
								: [...(filterValue || []), value];

							column?.setFilterValue(newValue);
						}}
					>
						<SearchIcon />
						Include
					</DropdownMenuItem>
				);
			case "input":
				return (
					<DropdownMenuItem onClick={() => column?.setFilterValue(value)}>
						<SearchIcon />
						Include
					</DropdownMenuItem>
				);
			case "slider":
				return (
					<DropdownMenuGroup>
						<DropdownMenuItem
							onClick={() => column?.setFilterValue([0, value])}
						>
							{/* FIXME: change icon as it is not clear */}
							<ChevronLeftIcon />
							Less or equal than
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => column?.setFilterValue([value, 5000])}
						>
							{/* FIXME: change icon as it is not clear */}
							<ChevronRightIcon />
							Greater or equal than
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => column?.setFilterValue([value])}>
							<EqualIcon />
							Equal to
						</DropdownMenuItem>
					</DropdownMenuGroup>
				);
			case "timerange": {
				const date = new Date(value);
				return (
					<DropdownMenuGroup>
						<DropdownMenuItem onClick={() => column?.setFilterValue([date])}>
							<CalendarSearchIcon />
							Exact timestamp
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => {
								const start = startOfHour(date);
								const end = endOfHour(date);
								column?.setFilterValue([start, end]);
							}}
						>
							<CalendarClockIcon />
							Same hour
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => {
								const start = startOfDay(date);
								const end = endOfDay(date);
								column?.setFilterValue([start, end]);
							}}
						>
							<CalendarDaysIcon />
							Same day
						</DropdownMenuItem>
					</DropdownMenuGroup>
				);
			}
			default:
				return null;
		}
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className={cn(
					"rounded-md ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
					"relative",
					className,
				)}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") {
						// REMINDER: default behavior is to open the dropdown menu
						// But because we use it to navigate between rows, we need to prevent it
						// and only use "Enter" to select the option
						e.preventDefault();
					}
					onKeyDown?.(e);
				}}
				{...props}
			>
				{children}
				{isCopied ? (
					<div className="absolute inset-0 bg-background/70 place-content-center">
						Value copied
					</div>
				) : null}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" side="left">
				{renderOptions()}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => copy(String(value), { timeout: 1000 })}
				>
					<CopyIcon />
					Copy value
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
