"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import { XIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useDataTable } from "@/components/data-table/provider";
import type { DataTableFilterField } from "@/components/data-table/types";

export function DataTableFilterResetButton<TData>({
	value: _value,
}: DataTableFilterField<TData>) {
	const { columnFilters, table } = useDataTable();
	const value = _value as string;
	const column = table.getColumn(value);

	// Get current filter value and normalize to array
	const filterValue = columnFilters.find((f) => f.id === value)?.value;
	const filters = useMemo(() => {
		if (!filterValue) {
			return [];
		}
		return Array.isArray(filterValue) ? filterValue : [filterValue];
	}, [filterValue]);

	// Handler to reset the filter
	const handleReset = useCallback(
		(e: React.MouseEvent | React.KeyboardEvent) => {
			e.stopPropagation();
			column?.setFilterValue(undefined);
		},
		[column]
	);

	// Don't render anything if there's no active filter
	if (filters.length === 0) {
		return null;
	}

	return (
		<Button
			asChild
			className="h-5 rounded-full px-1.5 py-1 font-mono text-[10px]"
			onClick={handleReset}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					handleReset(e);
				}
			}}
			variant="outline"
		>
			{/* REMINDER: `AccordionTrigger` is also a button(!) and we get Hydration error when rendering button within button */}
			<div role="button" tabIndex={0}>
				<span>{filters.length}</span>
				<XIcon className="ml-1 h-2.5 w-2.5 text-muted-foreground" />
			</div>
		</Button>
	);
}
