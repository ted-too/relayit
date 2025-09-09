"use client";

import useHotkeys from "@reecelucas/react-use-hotkeys";
import { Button } from "@repo/old-ui/components/shadcn/button";
import { ScrollArea } from "@repo/old-ui/components/shadcn/scroll-area";
import { Skeleton } from "@repo/old-ui/components/shadcn/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@repo/old-ui/components/shadcn/table";
import { useLocalStorage } from "@repo/old-ui/hooks/use-local-storage";
import { cn, formatCompactNumber } from "@repo/old-ui/lib/utils";
import { type Facets, SORT_DELIMITER } from "@repo/shared";
import type {
	FetchNextPageOptions,
	FetchPreviousPageOptions,
	RefetchOptions,
} from "@tanstack/react-query";
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFacetedRowModel,
	type OnChangeFn,
	type Row,
	type RowSelectionState,
	type SortingState,
	type Table as TTable,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table";
import { LoaderCircleIcon } from "lucide-react";
import {
	type ParserBuilder,
	parseAsArrayOf,
	parseAsString,
	useQueryState,
	useQueryStates,
} from "nuqs";
import {
	type CSSProperties,
	Fragment,
	memo,
	type UIEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { RESET_TABLE_VIEW } from "@/constants/keybinds";
import { useControls } from "./controls";
import { getFacetedMinMaxValues, getFacetedUniqueValues } from "./facets";
import { arrSome, inDateRange } from "./filter-fns";
import { DataTableFilterCommand } from "./filters/command";
import { DataTableFilterControls } from "./filters/controls";
import { DataTableProvider } from "./provider";
import { RefreshButton } from "./refresh-button";
import { DataTableResetButton } from "./reset-button";
import { MemoizedDataTableSheetContent } from "./sheet/content";
import { DataTableSheetDetails } from "./sheet/details";
import { DataTableToolbar } from "./toolbar";
import type { DataTableFilterField, SheetField } from "./types";

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
		options?: FetchNextPageOptions | undefined
	) => Promise<unknown>;
	fetchPreviousPage?: (
		options?: FetchPreviousPageOptions | undefined
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
	if (value === undefined || value === "" || value === null) {
		return null;
	}
	if (Array.isArray(value)) {
		const arrValue = value.filter(qpFilter) as T;
		if ((arrValue as unknown as unknown[]).length === 0) {
			return null;
		}
		return arrValue;
	}
	if (typeof value === "object" && Object.keys(value).length === 0) {
		return null;
	}
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
		[]
	);
	const [columnVisibility, setColumnVisibility] =
		useLocalStorage<VisibilityState>(
			`visibility-${tableId}`,
			defaultColumnVisibility
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
					value.map((filter) => [filter.id, filter.value])
				) as Partial<typeof columnFiltersQP>
			)
		);
	};

	const [rowSortingQP, setRowSortingQP] = useQueryState(
		"sort",
		parseAsArrayOf(parseAsString)
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
					(sort) => `${sort.id}${SORT_DELIMITER}${sort.desc ? "desc" : "asc"}`
				)
			)
		);
	};

	const [rowSelectionQP, setRowSelectionQP] = useQueryState(
		"id",
		parseAsArrayOf(parseAsString)
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
					.map(([key]) => key)
			)
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
		[fetchNextPage, isFetching, totalRowsFetched, filterRows]
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
		if (!topBar) {
			return;
		}

		observer.observe(topBar);
		return () => observer.unobserve(topBar);
	}, []);

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
		if ((isLoading || isFetching) && !data.length) {
			return;
		}
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
			if (!header) {
				continue;
			}
			// REMINDER: replace "." with "-" to avoid invalid CSS variable name (e.g. "timing.dns" -> "timing-dns")
			colSizes[`--header-${header.id.replace(".", "-")}-size`] =
				`${header.getSize()}px`;
			colSizes[`--col-${header.column.id.replace(".", "-")}-size`] =
				`${header.column.getSize()}px`;
		}
		return colSizes;
	}, [table.getFlatHeaders]);

	useHotkeys(RESET_TABLE_VIEW, () => {
		setColumnOrder([]);
		setColumnVisibility(defaultColumnVisibility);
	});

	return (
		<DataTableProvider
			columnFilters={columnFilters}
			columnOrder={columnOrder}
			columns={columns}
			columnVisibility={columnVisibility}
			controlsOpen={controlsOpen}
			enableColumnOrdering={true}
			facets={facets}
			filterFields={filterFields}
			filterRows={filterRows}
			isLoading={isFetching || isLoading}
			rowSelection={rowSelection}
			sorting={sorting}
			table={table}
			totalRows={totalRows}
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
						"h-full w-full flex-col sm:sticky sm:top-0 sm:max-h-(--available-height) sm:min-h-(--available-height) sm:min-w-52 sm:max-w-52 sm:self-start sm:border-r md:min-w-72 md:max-w-72",
						"group-data-[expanded=false]/controls:hidden",
						"hidden sm:flex"
					)}
				>
					<div className="border-border border-b bg-background p-2 pl-0 md:sticky md:top-0">
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
						"group-data-[expanded=true]/controls:sm:max-w-[calc(100vw_-_208px)] group-data-[expanded=true]/controls:md:max-w-[calc(100vw_-_288px)]"
					)}
				>
					<div
						className={cn(
							"flex items-center gap-4 bg-background",
							"sticky top-0 z-10 pb-4"
						)}
						ref={topBarRef}
					>
						<DataTableFilterCommand
							className="grow"
							searchParamsParser={searchParamsParser}
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
							className="border-separate border-spacing-0"
							containerClassName="max-h-[calc(var(--available-height)_-_var(--top-bar-height))]"
							// REMINDER: https://stackoverflow.com/questions/50361698/border-style-do-not-work-with-sticky-position-element
							onScroll={onScroll}
							ref={tableRef}
						>
							<HeaderComponent table={table} />
							<TableBody
								id="content"
								style={{
									scrollMarginTop: "calc(var(--top-bar-height) + 40px)",
								}}
								// className="outline-1 -outline-offset-1 outline-primary transition-colors focus-visible:outline"
								// REMINDER: avoids scroll (skipping the table header) when using skip to content
								tabIndex={-1}
							>
								{table.getRowModel().rows?.length ? (
									table.getRowModel().rows.map((row) => (
										<Fragment key={row.id}>
											<MemoizedRow
												row={row}
												selected={row.getIsSelected()}
												table={table}
												visibleColumns={columnVisibility}
											/>
										</Fragment>
									))
								) : isLoading || isFetching ? (
									<RowSkeleton columns={columns.length} rowCount={10} />
								) : (
									<TableRow>
										<TableCell
											className="h-24 text-center"
											colSpan={columns.length}
										>
											No results.
										</TableCell>
									</TableRow>
								)}
								<TableRow className="hover:bg-transparent data-[state=selected]:bg-transparent">
									<TableCell className="text-center" colSpan={columns.length}>
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
											<p className="text-muted-foreground text-sm">
												No more data to load (
												<span className="font-medium font-mono">
													{formatCompactNumber(filterRows)}
												</span>{" "}
												of{" "}
												<span className="font-medium font-mono">
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
					data={selectedRow?.original}
					fields={sheetFields}
					filterFields={filterFields}
					metadata={{
						totalRows,
						filterRows,
						totalRowsFetched,
						...meta,
					}}
					// TODO: check if we should memoize this
					// REMINDER: this is used to pass additional data like the `InfiniteQueryMeta`
					table={table}
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
			className={cn(
				"[&>:not(:last-child)]:border-r",
				"-outline-offset-1 outline-primary/30 transition-colors focus-visible:bg-muted/50 focus-visible:outline data-[state=selected]:outline",
				table.options.meta?.getRowClassName?.(row)
			)}
			data-state={selected && "selected"}
			id={row.id}
			onClick={() => row.toggleSelected()}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					row.toggleSelected();
				}
			}}
			tabIndex={0}
		>
			{row.getVisibleCells().map((cell) => (
				<TableCell
					className={cn(
						"truncate border-border border-b",
						cell.column.columnDef.meta?.cellClassName
					)}
					key={cell.id}
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
				prev.visibleColumns[colId] === next.visibleColumns[colId]
		);

	return basicPropsEqual && visibilityEqual;
}) as typeof RowComponent;

function RowSkeleton({
	columns,
	rowCount,
}: {
	columns: number;
	rowCount: number;
}) {
	return Array.from({ length: rowCount }).map((_, i) => (
		<TableRow
			className={cn(
				"[&>:not(:last-child)]:border-r",
				"-outline-offset-1 outline-primary/30 transition-colors focus-visible:bg-muted/50 focus-visible:outline data-[state=selected]:outline"
			)}
			key={`skeleton-row-${i}`}
		>
			<TableCell className="truncate border-border border-b" colSpan={columns}>
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
					className={cn(
						"bg-muted/50 hover:bg-muted/50",
						"[&>*]:border-t [&>:not(:last-child)]:border-r"
					)}
					key={headerGroup.id}
				>
					{headerGroup.headers.map((header) => {
						return (
							<TableHead
								aria-sort={
									header.column.getIsSorted() === "asc"
										? "ascending"
										: header.column.getIsSorted() === "desc"
											? "descending"
											: "none"
								}
								className={cn(
									"relative select-none truncate border-border border-b [&>.cursor-col-resize]:last:opacity-0",
									!open && "first:border-l last:border-r",
									header.column.columnDef.meta?.headerClassName
								)}
								key={header.id}
							>
								{header.isPlaceholder
									? null
									: flexRender(
											header.column.columnDef.header,
											header.getContext()
										)}
								{header.column.getCanResize() && (
									<div
										className={cn(
											"user-select-none -right-2 absolute top-0 z-10 flex h-full w-4 cursor-col-resize touch-none justify-center",
											"before:absolute before:inset-y-0 before:w-px before:translate-x-px before:bg-border"
										)}
										onDoubleClick={() => header.column.resetSize()}
										onMouseDown={header.getResizeHandler()}
										onTouchStart={header.getResizeHandler()}
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
