"use client";

import { InputWithAddons } from "@repo/ui/components/shadcn/input-with-addons";
import { Label } from "@repo/ui/components/shadcn/label";
import { Slider } from "@repo/ui/components/shadcn/slider";
import { useBasicDebounce } from "@repo/ui/hooks/use-debounce";
import { useEffect, useState } from "react";
import { isArrayOfNumbers } from "@/components/data-table/filter-fns";
import { useDataTable } from "@/components/data-table/provider";
import type { DataTableSliderFilterField } from "@/components/data-table/types";

function getFilter(filterValue: unknown) {
	return typeof filterValue === "number"
		? [filterValue, filterValue]
		: Array.isArray(filterValue) && isArrayOfNumbers(filterValue)
			? filterValue.length === 1
				? [filterValue[0], filterValue[0]]
				: filterValue
			: null;
}

export function DataTableFilterSlider<TData>({
	value: _value,
	min: defaultMin,
	max: defaultMax,
	unit,
}: DataTableSliderFilterField<TData>) {
	const value = _value as string;
	const { table, columnFilters, getFacetedMinMaxValues } = useDataTable();
	const column = table.getColumn(value);
	const filterValue = columnFilters.find((i) => i.id === value)?.value;
	const filters = getFilter(filterValue);

	// Initialize input state from current filter value or defaults
	const [min, max] = getFacetedMinMaxValues?.(table, value) ||
		column?.getFacetedMinMaxValues() || [defaultMin, defaultMax];

	// Use controlled inputs that directly update the filter
	const currentMin = filters?.[0] ?? min;
	const currentMax = filters?.[1] ?? max;

	const [internalValues, setInternalValues] = useState<[number, number]>([
		currentMin,
		currentMax,
	]);
	const debouncedValues = useBasicDebounce(internalValues, 250);

	useEffect(() => {
		column?.setFilterValue(debouncedValues);
	}, [debouncedValues, column?.setFilterValue]);

	useEffect(() => {
		setInternalValues([currentMin, currentMax]);
	}, [currentMin, currentMax]);

	// Handler functions for direct updates
	const handleSliderChange = (values: number[]) => {
		if (values.length === 2) {
			setInternalValues([values[0], values[1]]);
		}
	};

	const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newMin = Number(e.target.value);
		setInternalValues([newMin, internalValues[1]]);
	};

	const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newMax = Number(e.target.value);
		setInternalValues([internalValues[0], newMax]);
	};

	return (
		<div className="grid gap-2">
			<div className="flex items-center gap-4">
				<div className="grid w-full gap-1.5">
					<Label
						className="px-2 text-muted-foreground"
						htmlFor={`min-${value}`}
					>
						Min.
					</Label>
					<InputWithAddons
						containerClassName="mb-2 h-9 rounded-lg"
						id={`min-${value}`}
						max={max}
						min={min}
						name={`min-${value}`}
						onChange={handleMinChange}
						placeholder="from"
						trailing={unit}
						type="number"
						value={`${internalValues[0]}`}
					/>
				</div>
				<div className="grid w-full gap-1.5">
					<Label
						className="px-2 text-muted-foreground"
						htmlFor={`max-${value}`}
					>
						Max.
					</Label>
					<InputWithAddons
						containerClassName="mb-2 h-9 rounded-lg"
						id={`max-${value}`}
						max={max}
						min={min}
						name={`max-${value}`}
						onChange={handleMaxChange}
						placeholder="to"
						trailing={unit}
						type="number"
						value={`${internalValues[1]}`}
					/>
				</div>
			</div>
			<Slider
				max={max}
				min={min}
				onValueChange={handleSliderChange}
				value={internalValues}
			/>
		</div>
	);
}
