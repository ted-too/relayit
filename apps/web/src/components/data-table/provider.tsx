import type { DataTableFilterField } from "@/components/data-table/types";
import type {
	ColumnDef,
	ColumnFiltersState,
	PaginationState,
	RowSelectionState,
	SortingState,
	Table,
	VisibilityState,
} from "@tanstack/react-table";
import { createContext, useContext, useMemo } from "react";
import { ControlsProvider } from "./controls";
import type { Facets } from "@repo/shared";
import { getFacetedMinMaxValues, getFacetedUniqueValues } from "./facets";

// REMINDER: read about how to move controlled state out of the useReactTable hook
// https://github.com/TanStack/table/discussions/4005#discussioncomment-7303569

interface DataTableStateContextType<TData> {
	columnFilters: ColumnFiltersState;
	sorting: SortingState;
	rowSelection: RowSelectionState;
	columnOrder: string[];
	columnVisibility: VisibilityState;
	pagination: PaginationState;
	enableColumnOrdering: boolean;
	getFacetedUniqueValues: ReturnType<typeof getFacetedUniqueValues<TData>>;
	getFacetedMinMaxValues: ReturnType<typeof getFacetedMinMaxValues<TData>>;
	controlsOpen?: boolean;
	filterRows: number;
	totalRows: number;
}

interface DataTableBaseContextType<TData = unknown, TValue = unknown> {
	table: Table<TData>;
	filterFields: DataTableFilterField<TData>[];
	columns: ColumnDef<TData, TValue>[];
	isLoading?: boolean;
	facets?: Facets;
}

interface DataTableContextType<TData = unknown, TValue = unknown>
	extends DataTableStateContextType<TData>,
		DataTableBaseContextType<TData, TValue> {}

export const DataTableContext = createContext<DataTableContextType<
	any,
	any
> | null>(null);

export function DataTableProvider<TData, TValue>({
	children,
	...props
}: Partial<DataTableStateContextType<TData>> &
	DataTableBaseContextType<TData, TValue> & {
		children: React.ReactNode;
	}) {
	const value = useMemo(
		() => ({
			...props,
			getFacetedUniqueValues: getFacetedUniqueValues<TData>(props.facets),
			getFacetedMinMaxValues: getFacetedMinMaxValues<TData>(props.facets),
			columnFilters: props.columnFilters ?? [],
			sorting: props.sorting ?? [],
			rowSelection: props.rowSelection ?? {},
			columnOrder: props.columnOrder ?? [],
			columnVisibility: props.columnVisibility ?? {},
			pagination: props.pagination ?? { pageIndex: 0, pageSize: 10 },
			enableColumnOrdering: props.enableColumnOrdering ?? false,
			filterRows: props.filterRows ?? 0,
			totalRows: props.totalRows ?? 0,
		}),
		[
			props.columnFilters,
			props.sorting,
			props.rowSelection,
			props.columnOrder,
			props.columnVisibility,
			props.pagination,
			props.table,
			props.filterFields,
			props.columns,
			props.enableColumnOrdering,
			props.isLoading,
			props.facets,
			props.controlsOpen,
			props.filterRows,
			props.totalRows,
		],
	);

	return (
		<DataTableContext.Provider value={value}>
			<ControlsProvider ssrOpen={props.controlsOpen}>
				{children}
			</ControlsProvider>
		</DataTableContext.Provider>
	);
}

export function useDataTable<TData, TValue>() {
	const context = useContext(DataTableContext);

	if (!context) {
		throw new Error("useDataTable must be used within a DataTableProvider");
	}

	return context as DataTableContextType<TData, TValue>;
}
