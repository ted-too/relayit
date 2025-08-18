"use client";

import { useLocalStorage } from "@repo/ui/hooks/use-local-storage";
import { type Facets, SORT_DELIMITER } from "@repo/shared";
import type {
	FetchNextPageOptions,
	FetchPreviousPageOptions,
	RefetchOptions,
} from "@tanstack/react-query";
import {
	type ColumnFiltersState,
	type OnChangeFn,
	type SortingState,
	useReactTable,
	type ColumnDef,
	type VisibilityState,
	type RowSelectionState,
	type Table as TTable,
	getCoreRowModel,
	getFacetedRowModel,
	type Row,
	flexRender,
} from "@tanstack/react-table";
import {
	parseAsArrayOf,
	parseAsString,
	type ParserBuilder,
	useQueryState,
	useQueryStates,
} from "nuqs";
import {
	type CSSProperties,
	Fragment,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type UIEvent,
} from "react";
import { arrSome, inDateRange } from "./filter-fns";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@repo/ui/components/shadcn/table";
import { cn, formatCompactNumber } from "@repo/ui/lib/utils";
import useHotkeys from "@reecelucas/react-use-hotkeys";
import { useControls } from "./controls";
import { DataTableSheetDetails } from "./sheet/details";
import { MemoizedDataTableSheetContent } from "./sheet/content";
import { LoaderCircleIcon } from "lucide-react";
import { RefreshButton } from "./refresh-button";
import type { DataTableFilterField, SheetField } from "./types";
import { DataTableProvider } from "./provider";
import { DataTableResetButton } from "./reset-button";
import { ScrollArea } from "@repo/ui/components/shadcn/scroll-area";
import { getFacetedMinMaxValues, getFacetedUniqueValues } from "./facets";
import { DataTableFilterControls } from "./filters/controls";
import { DataTableToolbar } from "./toolbar";
import { DataTableFilterCommand } from "./filters/command";
import { RESET_TABLE_VIEW } from "@/constants/keybinds";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";

export type DataTableInfiniteProps<TData, TMeta> = {
	tableId: string;
	data: TData[];
	facets?: Facets;
	columns: ColumnDef<TData>[];
	meta?: TMeta;
	filterFields?: DataTableFilterField<TData>[];
	sheetFields?: SheetField<TData, TMeta>[];
	getRowId: (row: TData) => string;
	fetchNextPage: (
		options?: FetchNextPageOptions | undefined,
	) => Promise<unknown>;
	fetchPreviousPage?: (
		options?: FetchPreviousPageOptions | undefined,
	) => Promise<unknown>;
	refetch: (options?: RefetchOptions | undefined) => void;
	isFetching: boolean;
	isLoading: boolean;
	totalRows: number;
	filterRows: number;
	totalRowsFetched: number;
	defaultColumnFilters?: ColumnFiltersState;
	defaultColumnSorting?: SortingState;
	defaultRowSelection?: RowSelectionState;
	defaultColumnVisibility?: VisibilityState;
	searchParamsParser: Record<string, ParserBuilder<any>>;
	getRowSheetTitle: string | ((row: TData) => string);
	controlsOpen?: boolean;
};

const qpFilter = (value: unknown) =>
	value !== undefined && value !== "" && value !== null;

// This is needed so empty params are not sent to the server
function processQp<T = unknown>(value: T): T | null {
	if (value === undefined || value === "" || value === null) return null;
	if (Array.isArray(value)) {
		const arrValue = value.filter(qpFilter) as T;
		if ((arrValue as unknown as unknown[]).length === 0) return null;
		return arrValue;
	}
	if (typeof value === "object" && Object.keys(value).length === 0) return null;
	return value;
}

// TODO: This would probably be better virtualized
export function DataTableInfinite<TData, TMeta>({
	tableId,
	data,
	facets = {} as Facets,
	columns,
	filterFields = [],
	sheetFields = [],
	meta = {} as TMeta,
	getRowId,
	totalRows,
	filterRows,
	totalRowsFetched,
	isFetching,
	isLoading,
	fetchNextPage,
	fetchPreviousPage,
	refetch,
	defaultColumnFilters = [],
	defaultColumnSorting = [],
	defaultRowSelection = {},
	defaultColumnVisibility = {},
	searchParamsParser,
	getRowSheetTitle,
	controlsOpen,
}: DataTableInfiniteProps<TData, TMeta>) {
	const [columnOrder, setColumnOrder] = useLocalStorage<string[]>(
		`column-order-${tableId}`,
		[],
	);
	const [columnVisibility, setColumnVisibility] =
		useLocalStorage<VisibilityState>(
			`visibility-${tableId}`,
			defaultColumnVisibility,
		);

	const [columnFiltersQP, setColumnFiltersQP] =
		useQueryStates(searchParamsParser);

	const columnFilters: ColumnFiltersState = useMemo(() => {
		return Object.entries(columnFiltersQP)
			.filter(([_, value]) => qpFilter(value))
			.map(([key, value]) => ({
				id: key,
				value,
			}));
	}, [columnFiltersQP]);

	const setColumnFilters: OnChangeFn<ColumnFiltersState> = (columnFilters) => {
		let value: ColumnFiltersState | undefined;
		if (typeof columnFilters === "function") {
			value = columnFilters(defaultColumnFilters);
		} else {
			value = columnFilters;
		}

		setColumnFiltersQP(
			processQp(
				Object.fromEntries(
					value.map((filter) => [filter.id, filter.value]),
				) as Partial<typeof columnFiltersQP>,
			),
		);
	};

	const [rowSortingQP, setRowSortingQP] = useQueryState(
		"sort",
		parseAsArrayOf(parseAsString),
	);

	const sorting: SortingState = useMemo(() => {
		return (rowSortingQP ?? []).filter(qpFilter).map((sort) => {
			const [id, dir] = sort.split(SORT_DELIMITER);
			return {
				id,
				desc: dir === "desc",
			};
		});
	}, [rowSortingQP]);

	const setSorting: OnChangeFn<SortingState> = (sorting) => {
		let value: SortingState | undefined;
		if (typeof sorting === "function") {
			value = sorting(defaultColumnSorting);
		} else {
			value = sorting;
		}

		setRowSortingQP(
			processQp(
				value?.map(
					(sort) => `${sort.id}${SORT_DELIMITER}${sort.desc ? "desc" : "asc"}`,
				),
			),
		);
	};

	const [rowSelectionQP, setRowSelectionQP] = useQueryState(
		"id",
		parseAsArrayOf(parseAsString),
	);

	const rowSelection: RowSelectionState = useMemo(() => {
		return (rowSelectionQP ?? []).filter(qpFilter).reduce((acc, id) => {
			acc[id] = true;
			return acc;
		}, {} as RowSelectionState);
	}, [rowSelectionQP]);

	const setRowSelection: OnChangeFn<RowSelectionState> = (rowSelection) => {
		let value: RowSelectionState | undefined;
		if (typeof rowSelection === "function") {
			value = rowSelection(defaultRowSelection);
		} else {
			value = rowSelection;
		}

		setRowSelectionQP(
			processQp(
				Object.entries(value)
					.filter(([_, selected]) => selected)
					.map(([key]) => key),
			),
		);
	};

	const topBarRef = useRef<HTMLDivElement>(null);
	const tableRef = useRef<HTMLTableElement>(null);
	const [topBarHeight, setTopBarHeight] = useState(0);

	const onScroll = useCallback(
		(e: UIEvent<HTMLElement>) => {
			const onPageBottom =
				Math.ceil(e.currentTarget.scrollTop + e.currentTarget.clientHeight) >=
				e.currentTarget.scrollHeight;
			if (
				onPageBottom &&
				!isFetching &&
				totalRowsFetched < filterRows &&
				filterRows !== 0
			) {
				fetchNextPage();
			}
		},
		[fetchNextPage, isFetching, totalRowsFetched, filterRows],
	);

	useEffect(() => {
		// Keeps the top bar height updated and thus the table height
		const observer = new ResizeObserver(() => {
			const rect = topBarRef.current?.getBoundingClientRect();
			if (rect) {
				setTopBarHeight(rect.height);
			}
		});

		const topBar = topBarRef.current;
		if (!topBar) return;

		observer.observe(topBar);
		return () => observer.unobserve(topBar);
	}, [topBarRef]);

	const table = useReactTable({
		data,
		columns,
		state: {
			columnFilters,
			sorting,
			columnVisibility,
			rowSelection,
			columnOrder,
		},
		enableMultiRowSelection: false,
		columnResizeMode: "onChange",
		getRowId,
		onColumnVisibilityChange: setColumnVisibility,
		onColumnFiltersChange: setColumnFilters,
		onRowSelectionChange: setRowSelection,
		onSortingChange: setSorting,
		onColumnOrderChange: setColumnOrder,
		manualFiltering: true,
		manualSorting: true,
		getCoreRowModel: getCoreRowModel(),
		getFacetedRowModel: getFacetedRowModel(),
		getFacetedUniqueValues: (table, columnId) => () =>
			getFacetedUniqueValues<TData>(facets)(table, columnId),
		getFacetedMinMaxValues: (table, columnId) => () =>
			getFacetedMinMaxValues<TData>(facets)(table, columnId),
		filterFns: { inDateRange, arrSome },
		debugAll: process.env.NEXT_PUBLIC_TABLE_DEBUG === "true",
	});

	const selectedRow = useMemo(() => {
		if ((isLoading || isFetching) && !data.length) return;
		const selectedRowKey = Object.keys(rowSelection)?.[0];
		return table
			.getCoreRowModel()
			.flatRows.find((row) => row.id === selectedRowKey);
	}, [rowSelection, table, isLoading, isFetching, data]);

	/**
	 * https://tanstack.com/table/v8/docs/guide/column-sizing#advanced-column-resizing-performance
	 * Instead of calling `column.getSize()` on every render for every header
	 * and especially every data cell (very expensive),
	 * we will calculate all column sizes at once at the root table level in a useMemo
	 * and pass the column sizes down as CSS variables to the <table> element.
	 */
	const columnSizeVars = useMemo(() => {
		const headers = table.getFlatHeaders();
		const colSizes: { [key: string]: string } = {};
		for (let i = 0; i < headers.length; i++) {
			const header = headers[i];
			if (!header) continue;
			// REMINDER: replace "." with "-" to avoid invalid CSS variable name (e.g. "timing.dns" -> "timing-dns")
			colSizes[`--header-${header.id.replace(".", "-")}-size`] =
				`${header.getSize()}px`;
			colSizes[`--col-${header.column.id.replace(".", "-")}-size`] =
				`${header.column.getSize()}px`;
		}
		return colSizes;
	}, [
		table.getState().columnSizingInfo,
		table.getState().columnSizing,
		table.getState().columnVisibility,
	]);

	useHotkeys(RESET_TABLE_VIEW, () => {
		setColumnOrder([]);
		setColumnVisibility(defaultColumnVisibility);
	});

	return (
		<DataTableProvider
			table={table}
			columns={columns}
			facets={facets}
			filterFields={filterFields}
			columnFilters={columnFilters}
			filterRows={filterRows}
			totalRows={totalRows}
			sorting={sorting}
			rowSelection={rowSelection}
			columnOrder={columnOrder}
			columnVisibility={columnVisibility}
			enableColumnOrdering={true}
			isLoading={isFetching || isLoading}
			controlsOpen={controlsOpen}
		>
			<div
				className="flex h-full min-h-(--available-height) w-full flex-col sm:flex-row"
				style={
					{
						"--available-height":
							"var(--tab-content-height, var(--content-height))",
						"--top-bar-height": `${topBarHeight}px`,
						...columnSizeVars,
					} as CSSProperties
				}
			>
				<div
					className={cn(
						"h-full w-full flex-col sm:sticky sm:top-0 sm:max-h-(--available-height) sm:min-h-(--available-height) sm:min-w-52 sm:max-w-52 sm:self-start md:min-w-72 md:max-w-72 sm:border-r",
						"group-data-[expanded=false]/controls:hidden",
						"hidden sm:flex",
					)}
				>
					<div className="border-b border-border bg-background p-2 pl-0 md:sticky md:top-0">
						<div className="flex h-[46px] items-center justify-between gap-3">
							<p className="px-2 font-medium text-foreground">Filters</p>
							<div>
								{table.getState().columnFilters.length ? (
									<DataTableResetButton />
								) : null}
							</div>
						</div>
					</div>
					<ScrollArea className="w-full grow p-2 pl-0">
						<DataTableFilterControls />
					</ScrollArea>
				</div>

				<div
					className={cn(
						"flex max-w-full flex-1 flex-col border-border",
						// Chrome issue
						"group-data-[expanded=true]/controls:sm:max-w-[calc(100vw_-_208px)] group-data-[expanded=true]/controls:md:max-w-[calc(100vw_-_288px)]",
					)}
				>
					<div
						ref={topBarRef}
						className={cn(
							"flex items-center gap-4 bg-background",
							"sticky top-0 z-10 pb-4",
						)}
					>
						<DataTableFilterCommand
							searchParamsParser={searchParamsParser}
							className="grow"
							tableId={tableId}
						/>
						{/* TBD: better flexibility with compound components? */}
						<DataTableToolbar
							renderActions={() => [
								<RefreshButton key="refresh" onClick={refetch} />,
							]}
						/>
					</div>
					<div className="z-0 grow">
						<Table
							ref={tableRef}
							onScroll={onScroll}
							// REMINDER: https://stackoverflow.com/questions/50361698/border-style-do-not-work-with-sticky-position-element
							className="border-separate border-spacing-0"
							containerClassName="max-h-[calc(var(--available-height)_-_var(--top-bar-height))]"
						>
							<HeaderComponent table={table} />
							<TableBody
								id="content"
								tabIndex={-1}
								// className="outline-1 -outline-offset-1 outline-primary transition-colors focus-visible:outline"
								// REMINDER: avoids scroll (skipping the table header) when using skip to content
								style={{
									scrollMarginTop: "calc(var(--top-bar-height) + 40px)",
								}}
							>
								{table.getRowModel().rows?.length ? (
									table.getRowModel().rows.map((row) => (
										<Fragment key={row.id}>
											<MemoizedRow
												row={row}
												table={table}
												selected={row.getIsSelected()}
												visibleColumns={columnVisibility}
											/>
										</Fragment>
									))
								) : isLoading || isFetching ? (
									<RowSkeleton columns={columns.length} rowCount={10} />
								) : (
									<Fragment>
										<TableRow>
											<TableCell
												colSpan={columns.length}
												className="h-24 text-center"
											>
												No results.
											</TableCell>
										</TableRow>
									</Fragment>
								)}
								<TableRow className="hover:bg-transparent data-[state=selected]:bg-transparent">
									<TableCell colSpan={columns.length} className="text-center">
										{(totalRowsFetched < filterRows ||
											!table.getCoreRowModel().rows?.length) &&
										filterRows !== 0 ? (
											<Button
												disabled={isFetching || isLoading}
												onClick={() => fetchNextPage()}
												size="sm"
												variant="outline"
											>
												{isFetching ? (
													<LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />
												) : null}
												Load More
											</Button>
										) : (
											<p className="text-sm text-muted-foreground">
												No more data to load (
												<span className="font-mono font-medium">
													{formatCompactNumber(filterRows)}
												</span>{" "}
												of{" "}
												<span className="font-mono font-medium">
													{formatCompactNumber(totalRows)}
												</span>{" "}
												rows)
											</p>
										)}
									</TableCell>
								</TableRow>
							</TableBody>
						</Table>
					</div>
				</div>
			</div>
			<DataTableSheetDetails
				title={
					typeof getRowSheetTitle === "function"
						? selectedRow?.original
							? getRowSheetTitle(selectedRow.original)
							: undefined
						: getRowSheetTitle
				}
				titleClassName="font-mono"
			>
				<MemoizedDataTableSheetContent
					table={table}
					data={selectedRow?.original}
					filterFields={filterFields}
					fields={sheetFields}
					// TODO: check if we should memoize this
					// REMINDER: this is used to pass additional data like the `InfiniteQueryMeta`
					metadata={{
						totalRows,
						filterRows,
						totalRowsFetched,
						...meta,
					}}
				/>
			</DataTableSheetDetails>
		</DataTableProvider>
	);
}

/**
 * REMINDER: this is the heaviest component in the table if lots of rows
 * Some other components are rendered more often necessary, but are fixed size (not like rows that can grow in height)
 * e.g. DataTableFilterControls, DataTableFilterCommand, DataTableToolbar, DataTableHeader
 */

function RowComponent<TData>({
	row,
	table,
	selected,
}: {
	row: Row<TData>;
	table: TTable<TData>;
	// REMINDER: row.getIsSelected() and visibleColumns; - just for memoization
	selected?: boolean;
	visibleColumns: VisibilityState;
}) {
	return (
		<TableRow
			id={row.id}
			tabIndex={0}
			data-state={selected && "selected"}
			onClick={() => row.toggleSelected()}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					row.toggleSelected();
				}
			}}
			className={cn(
				"[&>:not(:last-child)]:border-r",
				"-outline-offset-1 outline-primary/30 transition-colors focus-visible:bg-muted/50 focus-visible:outline data-[state=selected]:outline",
				table.options.meta?.getRowClassName?.(row),
			)}
		>
			{row.getVisibleCells().map((cell) => (
				<TableCell
					key={cell.id}
					className={cn(
						"truncate border-b border-border",
						cell.column.columnDef.meta?.cellClassName,
					)}
				>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	);
}

const MemoizedRow = memo(RowComponent, (prev, next) => {
	// Check if row ID and selection state are the same
	const basicPropsEqual =
		prev.row.id === next.row.id && prev.selected === next.selected;

	// Check if visible columns are the same
	const prevVisibleColumnsKeys = Object.keys(prev.visibleColumns);
	const nextVisibleColumnsKeys = Object.keys(next.visibleColumns);

	const visibilityEqual =
		prevVisibleColumnsKeys.length === nextVisibleColumnsKeys.length &&
		prevVisibleColumnsKeys.every(
			(colId) =>
				nextVisibleColumnsKeys.includes(colId) &&
				prev.visibleColumns[colId] === next.visibleColumns[colId],
		);

	return basicPropsEqual && visibilityEqual;
}) as typeof RowComponent;

function RowSkeleton({
	columns,
	rowCount,
}: { columns: number; rowCount: number }) {
	return Array.from({ length: rowCount }).map((_, i) => (
		<TableRow
			className={cn(
				"[&>:not(:last-child)]:border-r",
				"-outline-offset-1 outline-primary/30 transition-colors focus-visible:bg-muted/50 focus-visible:outline data-[state=selected]:outline",
			)}
			key={`skeleton-row-${i}`}
		>
			<TableCell colSpan={columns} className="truncate border-b border-border">
				<Skeleton className="h-5 w-full" />
			</TableCell>
		</TableRow>
	));
}

function HeaderComponent<TData>({ table }: { table: TTable<TData> }) {
	const { open } = useControls();
	return (
		<TableHeader className={cn("sticky top-0 z-20 bg-background")}>
			{table.getHeaderGroups().map((headerGroup) => (
				<TableRow
					key={headerGroup.id}
					className={cn(
						"bg-muted/50 hover:bg-muted/50",
						"[&>*]:border-t [&>:not(:last-child)]:border-r",
					)}
				>
					{headerGroup.headers.map((header) => {
						return (
							<TableHead
								key={header.id}
								className={cn(
									"relative select-none truncate border-b border-border [&>.cursor-col-resize]:last:opacity-0",
									!open && "first:border-l last:border-r",
									header.column.columnDef.meta?.headerClassName,
								)}
								aria-sort={
									header.column.getIsSorted() === "asc"
										? "ascending"
										: header.column.getIsSorted() === "desc"
											? "descending"
											: "none"
								}
							>
								{header.isPlaceholder
									? null
									: flexRender(
											header.column.columnDef.header,
											header.getContext(),
										)}
								{header.column.getCanResize() && (
									<div
										onDoubleClick={() => header.column.resetSize()}
										onMouseDown={header.getResizeHandler()}
										onTouchStart={header.getResizeHandler()}
										className={cn(
											"user-select-none absolute -right-2 top-0 z-10 flex h-full w-4 cursor-col-resize touch-none justify-center",
											"before:absolute before:inset-y-0 before:w-px before:translate-x-px before:bg-border",
										)}
									/>
								)}
							</TableHead>
						);
					})}
				</TableRow>
			))}
		</TableHeader>
	);
}
