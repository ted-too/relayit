"use client";

import { Checkbox } from "@repo/ui/components/shadcn/checkbox";
import { InputWithAddons } from "@repo/ui/components/shadcn/input-with-addons";
import { Label } from "@repo/ui/components/shadcn/label";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { cn, formatCompactNumber } from "@repo/ui/lib/utils";
import { SearchIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useDataTable } from "@/components/data-table/provider";
import type { DataTableCheckboxFilterField } from "@/components/data-table/types";

export function DataTableFilterCheckbox<TData>({
	value: _value,
	options,
	component,
}: DataTableCheckboxFilterField<TData>) {
	const value = _value as string;
	const [inputValue, setInputValue] = useState("");
	const { table, columnFilters, isLoading, getFacetedUniqueValues } =
		useDataTable();

	const column = table.getColumn(value);
	// Get the current filter value from column filters
	const filterValue = columnFilters.find((i) => i.id === value)?.value;
	const facetedValue =
		getFacetedUniqueValues?.(table, value) || column?.getFacetedUniqueValues();

	// Value may be a single value or an array
	const filters = filterValue
		? Array.isArray(filterValue)
			? filterValue
			: [filterValue]
		: [];

	const Component = component;

	// Handler to update checkbox selection
	const handleCheckboxChange = useCallback(
		(optionValue: unknown, checked: boolean) => {
			const newValue = checked
				? [...filters, optionValue]
				: filters.filter((value) => optionValue !== value);

			column?.setFilterValue(newValue.length > 0 ? newValue : undefined);
		},
		[column, filters]
	);

	// Handler to select a single option (exclusive)
	const handleSelectOnly = useCallback(
		(optionValue: unknown) => {
			column?.setFilterValue([optionValue]);
		},
		[column]
	);

	// Filter options based on the input search value
	const filterOptions = options?.filter(
		(option) =>
			inputValue === "" ||
			option.label.toLowerCase().includes(inputValue.toLowerCase())
	);

	// REMINDER: if no options are defined, while fetching data, we should show a skeleton
	if (isLoading && !filterOptions?.length) {
		return (
			<div className="grid divide-y rounded-lg border border-border">
				{Array.from({ length: 3 }).map((_, index) => (
					<div
						className="flex items-center justify-between gap-2 px-2 py-2.5"
						key={index}
					>
						<Skeleton className="h-4 w-4 rounded-sm" />
						<Skeleton className="h-4 w-full rounded-sm" />
					</div>
				))}
			</div>
		);
	}

	if (!filterOptions?.length) {
		return null;
	}

	return (
		<div className="grid gap-2">
			{options && options.length > 8 ? (
				<InputWithAddons
					containerClassName="h-9 rounded-lg"
					leading={<SearchIcon className="mt-0.5 h-4 w-4" />}
					onChange={(e) => setInputValue(e.target.value)}
					placeholder="Search"
					value={inputValue}
				/>
			) : null}
			<div className="rounded-lg border border-border empty:border-none">
				{filterOptions.map((option, index) => {
					const checked = filters.includes(option.value);

					return (
						<div
							className={cn(
								"group relative flex items-center space-x-2 px-2 py-2.5 hover:bg-accent/50",
								index !== filterOptions.length - 1 ? "border-b" : undefined
							)}
							key={String(option.value)}
						>
							<Checkbox
								checked={checked}
								id={`${value}-${option.value}`}
								onCheckedChange={(checked) =>
									handleCheckboxChange(option.value, !!checked)
								}
							/>
							<Label
								className="flex w-full items-center justify-center gap-1 truncate text-foreground/70 group-hover:text-accent-foreground"
								htmlFor={`${value}-${option.value}`}
							>
								{Component ? (
									<Component {...option} />
								) : (
									<span className="truncate font-normal">{option.label}</span>
								)}
								<span className="ml-auto flex items-center justify-center font-mono text-xs">
									{isLoading ? (
										<Skeleton className="h-4 w-4" />
									) : option?.value &&
										facetedValue?.has(option.value.toString()) ? (
										formatCompactNumber(
											facetedValue.get(option.value.toString()) || 0
										)
									) : null}
								</span>
								<button
									className={cn(
										"absolute inset-y-0 right-0 hidden font-normal text-muted-foreground backdrop-blur-sm hover:text-foreground group-hover:block",
										"rounded-md ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
									)}
									onClick={() => handleSelectOnly(option.value)}
									type="button"
								>
									<span className="px-2">only</span>
								</button>
							</Label>
						</div>
					);
				})}
			</div>
		</div>
	);
}
