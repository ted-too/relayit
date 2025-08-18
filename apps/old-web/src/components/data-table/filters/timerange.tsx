"use client";

import { DatePickerWithRange } from "@/components/shared/date-picker-with-range";
import { useDataTable } from "@/components/data-table/provider";
import type { DataTableTimerangeFilterField } from "@/components/data-table/types";
import { isArrayOfDates } from "@/components/data-table/filter-fns";
import { useCallback, useMemo } from "react";
import type { DateRange } from "react-day-picker";

export function DataTableFilterTimerange<TData>({
	value: _value,
	presets,
}: DataTableTimerangeFilterField<TData>) {
	const value = _value as string;
	const { table, columnFilters } = useDataTable();
	const column = table.getColumn(value);
	const filterValue = columnFilters.find((i) => i.id === value)?.value;

	const date: DateRange | undefined = useMemo(
		() =>
			filterValue instanceof Date
				? { from: filterValue, to: undefined }
				: Array.isArray(filterValue) && isArrayOfDates(filterValue)
					? { from: filterValue?.[0], to: filterValue?.[1] }
					: undefined,
		[filterValue],
	);

	const setDate = useCallback(
		(date: DateRange | undefined) => {
			if (!date?.from) {
				column?.setFilterValue(undefined);
				return;
			}

			if (date.from && !date.to) {
				column?.setFilterValue([date.from]);
			} else if (date.to && date.from) {
				column?.setFilterValue([date.from, date.to]);
			}
		},
		[column],
	);

	return (
		<DatePickerWithRange date={date} setDate={setDate} presets={presets} />
	);
}
