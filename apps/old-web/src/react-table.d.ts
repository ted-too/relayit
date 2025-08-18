import "@tanstack/react-table";

declare module "@tanstack/react-table" {
	// https://github.com/TanStack/table/issues/44#issuecomment-1377024296
	// biome-ignore lint/complexity/noUselessTypeConstraint: see above
	type TableMeta<TData extends unknown> = {
		getRowClassName?: (row: Row<TData>) => string;
	};

	type ColumnMeta = {
		headerClassName?: string;
		cellClassName?: string;
		label?: string;
	};

	type FilterFns = {
		inDateRange?: FilterFn<any>;
		arrSome?: FilterFn<any>;
	};

	// https://github.com/TanStack/table/discussions/4554
	type ColumnFiltersOptions<TData extends RowData> = {
		filterFns?: Record<string, FilterFn<TData>>;
	};
}
