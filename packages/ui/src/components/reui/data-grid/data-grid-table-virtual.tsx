import { useDataGrid } from "@repo/ui/components/reui/data-grid/data-grid";
import {
  DataGridTableBase,
  DataGridTableBody,
  DataGridTableEmpty,
  DataGridTableFillBodyCell,
  DataGridTableFillHeadCell,
  DataGridTableFoot,
  DataGridTableHead,
  DataGridTableHeadRow,
  DataGridTableHeadRowCell,
  DataGridTableHeadRowCellResize,
  DataGridTableRenderedRow,
  DataGridTableRowSpacer,
  DataGridTableViewport,
  getDataGridTableMergedHeaderGroups,
  getDataGridTableRowSections,
  getPinningStyles,
  hasDataGridTableRightPinnedColumns,
} from "@repo/ui/components/reui/data-grid/data-grid-table";
import { Spinner } from "@repo/ui/components/ui/coss/spinner";
import { cn } from "@repo/ui/lib/utils";
import {
  type Column,
  flexRender,
  type Row,
  type Table,
} from "@tanstack/react-table";
import {
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

interface DataGridTableVirtualScrollElements {
  containerElement: HTMLDivElement | null;
  scrollElement: HTMLElement | null;
}

type DataGridTableVirtualizerInstance = Virtualizer<
  HTMLElement,
  HTMLTableRowElement
>;

type DataGridTableVirtualizerOptions<TData> = Omit<
  VirtualizerOptions<HTMLElement, HTMLTableRowElement>,
  "count" | "estimateSize" | "getItemKey" | "getScrollElement"
> & {
  estimateSize?: (index: number, row: Row<TData>) => number;
  getItemKey?: (index: number, row: Row<TData>) => string | number;
  getScrollElement?: (
    elements: DataGridTableVirtualScrollElements
  ) => HTMLElement | null;
};

interface DataGridTableVirtualProps<TData> {
  estimateSize?: number;
  fetchMoreOffset?: number;
  footerContent?: ReactNode;
  hasMore?: boolean;
  height?: number | string;
  isFetchingMore?: boolean;
  onFetchMore?: () => void;
  overscan?: number;
  renderHeader?: boolean;
  virtualizerOptions?: DataGridTableVirtualizerOptions<TData>;
}

interface VirtualBodyProps<TData> {
  allRowsLoadedMessage: ReactNode;
  bottomRows: Row<TData>[];
  centerRows: Row<TData>[];
  hasMore?: boolean;
  isFetchingMore: boolean;
  isInfiniteMode: boolean;
  isVirtualizationEnabled: boolean;
  loadingMoreMessage: ReactNode;
  measureRowRef?: (element: HTMLTableRowElement | null) => void;
  table: Table<TData>;
  topRows: Row<TData>[];
  totalSize: number;
  virtualItems: VirtualItem[];
}

function DataGridTableVirtualPinnedPlaceholderCell<TData>({
  column,
}: {
  column: Column<TData>;
}) {
  const { props } = useDataGrid();
  const isPinned = column.getIsPinned();
  const isLastLeftPinned =
    isPinned === "left" && column.getIsLastColumn("left");
  const isFirstRightPinned =
    isPinned === "right" && column.getIsFirstColumn("right");

  return (
    <td
      aria-hidden="true"
      className={cn(
        "p-0",
        props.tableLayout?.cellBorder && "border-e",
        props.tableLayout?.columnsPinnable &&
          column.getCanPin() &&
          "data-pinned:isolate data-pinned:bg-background [&[data-pinned=left][data-last-col=left]]:shadow-[inset_-1px_0_0_0_var(--border)] [&[data-pinned=right][data-last-col=right]]:shadow-[inset_1px_0_0_0_var(--border)]"
      )}
      data-last-col={
        isLastLeftPinned ? "left" : isFirstRightPinned ? "right" : undefined
      }
      data-pinned={isPinned || undefined}
      style={{
        ...(props.tableLayout?.columnsPinnable &&
          column.getCanPin() &&
          getPinningStyles(column)),
        ...(props.tableLayout?.columnsResizable && {
          width: `calc(var(--col-${column.id}-size) * 1px)`,
        }),
      }}
    />
  );
}

function DataGridTableVirtualUtilityRow<TData>({
  table,
  children,
  centerCellClassName,
  centerCellStyle,
  rowClassName,
  ariaHidden,
}: {
  table: Table<TData>;
  children: ReactNode;
  centerCellClassName?: string;
  centerCellStyle?: CSSProperties;
  rowClassName?: string;
  ariaHidden?: boolean;
}) {
  const { props } = useDataGrid();
  const leftVisibleColumns = table.getLeftVisibleLeafColumns();
  const centerVisibleColumns = table.getCenterVisibleLeafColumns();
  const rightVisibleColumns = table.getRightVisibleLeafColumns();
  const hasRightPinnedColumns = hasDataGridTableRightPinnedColumns(table);

  return (
    <tr aria-hidden={ariaHidden || undefined} className={rowClassName}>
      {leftVisibleColumns.map((column) => (
        <DataGridTableVirtualPinnedPlaceholderCell
          column={column}
          key={column.id}
        />
      ))}
      <td
        className={centerCellClassName}
        colSpan={Math.max(centerVisibleColumns.length, 1)}
        style={centerCellStyle}
      >
        {children}
      </td>
      {props.tableLayout?.columnsResizable && hasRightPinnedColumns ? (
        <DataGridTableFillBodyCell />
      ) : null}
      {rightVisibleColumns.map((column) => (
        <DataGridTableVirtualPinnedPlaceholderCell
          column={column}
          key={column.id}
        />
      ))}
      {props.tableLayout?.columnsResizable && !hasRightPinnedColumns ? (
        <DataGridTableFillBodyCell />
      ) : null}
    </tr>
  );
}

function DataGridTableVirtualSpacer<TData>({
  table,
  height,
}: {
  table: Table<TData>;
  height: number;
}) {
  if (height <= 0) {
    return null;
  }

  return (
    <DataGridTableVirtualUtilityRow
      ariaHidden
      centerCellClassName="p-0"
      centerCellStyle={{ height, padding: 0 }}
      table={table}
    >
      {null}
    </DataGridTableVirtualUtilityRow>
  );
}

function DataGridTableVirtualStatusRow<TData>({
  table,
  children,
  className,
}: {
  table: Table<TData>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DataGridTableVirtualUtilityRow
      centerCellClassName={cn(
        "py-4 text-center text-muted-foreground text-sm",
        className
      )}
      table={table}
    >
      {children}
    </DataGridTableVirtualUtilityRow>
  );
}

function DataGridTableVirtualBody<TData>({
  table,
  topRows,
  centerRows,
  bottomRows,
  virtualItems,
  totalSize,
  isVirtualizationEnabled,
  isInfiniteMode,
  isFetchingMore,
  hasMore,
  loadingMoreMessage,
  allRowsLoadedMessage,
  measureRowRef,
}: VirtualBodyProps<TData>) {
  const totalRows = topRows.length + centerRows.length + bottomRows.length;

  if (!totalRows) {
    return <DataGridTableEmpty />;
  }

  const hasCenterRows = centerRows.length > 0;
  const showFetchingRow = isInfiniteMode && isFetchingMore;
  const showCompleteRow = isInfiniteMode && hasMore === false && totalRows > 0;
  const hasMiddleSection = hasCenterRows || showFetchingRow || showCompleteRow;
  const leadingSpacerHeight =
    isVirtualizationEnabled && hasCenterRows && virtualItems.length > 0
      ? (virtualItems[0]?.start ?? 0)
      : 0;
  const trailingSpacerHeight =
    isVirtualizationEnabled && hasCenterRows && virtualItems.length > 0
      ? Math.max(0, totalSize - (virtualItems.at(-1)?.end ?? 0))
      : 0;

  const renderedRows: ReactNode[] = [];

  topRows.forEach((row, index) => {
    renderedRows.push(
      <DataGridTableRenderedRow
        key={row.id}
        pinnedBoundary={
          index === topRows.length - 1 && hasMiddleSection ? "top" : undefined
        }
        row={row}
      />
    );
  });

  if (isVirtualizationEnabled) {
    if (leadingSpacerHeight > 0) {
      renderedRows.push(
        <DataGridTableVirtualSpacer
          height={leadingSpacerHeight}
          key="virtual-spacer-start"
          table={table}
        />
      );
    }

    for (const virtualRow of virtualItems) {
      const row = centerRows[virtualRow.index];

      if (!row) {
        continue;
      }

      renderedRows.push(
        <DataGridTableRenderedRow
          key={row.id}
          row={row}
          rowRef={measureRowRef}
        />
      );
    }

    if (trailingSpacerHeight > 0) {
      renderedRows.push(
        <DataGridTableVirtualSpacer
          height={trailingSpacerHeight}
          key="virtual-spacer-end"
          table={table}
        />
      );
    }
  } else {
    for (const row of centerRows) {
      renderedRows.push(<DataGridTableRenderedRow key={row.id} row={row} />);
    }
  }

  if (showFetchingRow) {
    renderedRows.push(
      <DataGridTableVirtualStatusRow key="virtual-status-loading" table={table}>
        <div className="flex items-center justify-center gap-2">
          <Spinner className="size-4 opacity-60" />
          {loadingMoreMessage}
        </div>
      </DataGridTableVirtualStatusRow>
    );
  }

  if (showCompleteRow) {
    renderedRows.push(
      <DataGridTableVirtualStatusRow
        className="py-3 text-xs"
        key="virtual-status-complete"
        table={table}
      >
        {allRowsLoadedMessage}
      </DataGridTableVirtualStatusRow>
    );
  }

  bottomRows.forEach((row, index) => {
    renderedRows.push(
      <DataGridTableRenderedRow
        key={row.id}
        pinnedBoundary={
          index === 0 && (topRows.length > 0 || hasMiddleSection)
            ? "bottom"
            : undefined
        }
        row={row}
      />
    );
  });

  return <>{renderedRows}</>;
}

/**
 * Memoized virtual body: skip re-renders during active column resize.
 * Column widths update via CSS variables on the <table> element,
 * so the browser handles width changes without React re-renders.
 */
const MemoizedVirtualBody = memo(
  DataGridTableVirtualBody,
  (_prev, next) => !!next.table.getState().columnSizingInfo.isResizingColumn
) as typeof DataGridTableVirtualBody;

function DataGridTableVirtual<TData>({
  height,
  estimateSize = 48,
  overscan = 10,
  footerContent,
  renderHeader = true,
  onFetchMore,
  isFetchingMore = false,
  hasMore,
  fetchMoreOffset = 0,
  virtualizerOptions,
}: DataGridTableVirtualProps<TData>) {
  const { table, props } = useDataGrid();
  const mergedHeaderGroups = getDataGridTableMergedHeaderGroups(table);
  const hasRightPinnedColumns = hasDataGridTableRightPinnedColumns(table);
  const { topRows, centerRows, bottomRows } = getDataGridTableRowSections(
    table,
    props.tableLayout?.rowsPinnable
  );
  const isInfiniteMode = typeof onFetchMore === "function";
  const [viewportElements, setViewportElements] =
    useState<DataGridTableVirtualScrollElements>({
      containerElement: null,
      scrollElement: null,
    });

  const {
    estimateSize: customEstimateSize,
    getItemKey: customGetItemKey,
    getScrollElement: customGetScrollElement,
    measureElement: customMeasureElement,
    overscan: customOverscan,
    ...virtualizerOptionsRest
  } = virtualizerOptions ?? {};

  const isVirtualizationEnabled = virtualizerOptions?.enabled !== false;
  const loadingMoreMessage =
    props.fetchingMoreMessage || props.loadingMessage || "Loading...";
  const allRowsLoadedMessage =
    props.allRowsLoadedMessage || "All records loaded";

  const handleViewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewportElements({
      containerElement: node,
      scrollElement:
        (node?.closest(
          '[data-slot="scroll-area-viewport"]'
        ) as HTMLElement | null) ?? node,
    });
  }, []);

  const usesExternalScrollArea =
    viewportElements.scrollElement !== null &&
    viewportElements.scrollElement !== viewportElements.containerElement;

  const resolveScrollElement = useCallback(() => {
    if (customGetScrollElement) {
      return customGetScrollElement(viewportElements);
    }

    return viewportElements.scrollElement;
  }, [customGetScrollElement, viewportElements]);

  const resolveItemKey = useCallback(
    (index: number) => {
      const row = centerRows[index];

      if (!row) {
        return index;
      }

      return customGetItemKey?.(index, row) ?? row.id ?? index;
    },
    [centerRows, customGetItemKey]
  );

  const resolveEstimateSize = useCallback(
    (index: number) => {
      const row = centerRows[index];

      return row
        ? (customEstimateSize?.(index, row) ?? estimateSize)
        : estimateSize;
    },
    [centerRows, customEstimateSize, estimateSize]
  );

  const virtualizer = useVirtualizer({
    count: centerRows.length,
    getScrollElement: resolveScrollElement,
    getItemKey: resolveItemKey,
    estimateSize: resolveEstimateSize,
    overscan: customOverscan ?? overscan,
    measureElement: customMeasureElement,
    ...virtualizerOptionsRest,
  }) as DataGridTableVirtualizerInstance;

  const virtualItems = isVirtualizationEnabled
    ? virtualizer.getVirtualItems()
    : [];
  const totalSize = isVirtualizationEnabled ? virtualizer.getTotalSize() : 0;
  const measureRowRef =
    isVirtualizationEnabled && customMeasureElement
      ? virtualizer.measureElement
      : undefined;
  const resolvedFetchMoreOffset = Math.max(0, fetchMoreOffset);

  useEffect(() => {
    if (
      !(isVirtualizationEnabled && isInfiniteMode) ||
      hasMore === false ||
      isFetchingMore
    ) {
      return;
    }

    const lastItem = virtualItems.at(-1);
    if (!lastItem) {
      return;
    }

    if (lastItem.index >= centerRows.length - 1 - resolvedFetchMoreOffset) {
      onFetchMore?.();
    }
  }, [
    centerRows.length,
    hasMore,
    isFetchingMore,
    isInfiniteMode,
    isVirtualizationEnabled,
    onFetchMore,
    resolvedFetchMoreOffset,
    virtualItems,
  ]);

  return (
    <DataGridTableViewport
      className={usesExternalScrollArea ? undefined : "block"}
      style={
        usesExternalScrollArea
          ? undefined
          : { height, overflow: "auto", position: "relative" }
      }
      viewportRef={handleViewportRef}
    >
      <DataGridTableBase>
        {renderHeader && (
          <DataGridTableHead>
            {mergedHeaderGroups.map((headerGroup) => (
              <DataGridTableHeadRow key={headerGroup.id} rowId={headerGroup.id}>
                {headerGroup.headers
                  .filter((header) => header.column.getIsPinned() !== "right")
                  .map((header) => {
                    const { column } = header;

                    return (
                      <DataGridTableHeadRowCell header={header} key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                        {props.tableLayout?.columnsResizable &&
                          column.getCanResize() && (
                            <DataGridTableHeadRowCellResize header={header} />
                          )}
                      </DataGridTableHeadRowCell>
                    );
                  })}
                {props.tableLayout?.columnsResizable &&
                hasRightPinnedColumns ? (
                  <DataGridTableFillHeadCell />
                ) : null}
                {headerGroup.headers
                  .filter((header) => header.column.getIsPinned() === "right")
                  .map((header) => {
                    const { column } = header;

                    return (
                      <DataGridTableHeadRowCell header={header} key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                        {props.tableLayout?.columnsResizable &&
                          column.getCanResize() && (
                            <DataGridTableHeadRowCellResize header={header} />
                          )}
                      </DataGridTableHeadRowCell>
                    );
                  })}
                {props.tableLayout?.columnsResizable &&
                !hasRightPinnedColumns ? (
                  <DataGridTableFillHeadCell />
                ) : null}
              </DataGridTableHeadRow>
            ))}
          </DataGridTableHead>
        )}

        {renderHeader &&
          (props.tableLayout?.stripped || !props.tableLayout?.rowBorder) && (
            <DataGridTableRowSpacer />
          )}

        <DataGridTableBody>
          <MemoizedVirtualBody
            allRowsLoadedMessage={allRowsLoadedMessage}
            bottomRows={bottomRows}
            centerRows={centerRows}
            hasMore={hasMore}
            isFetchingMore={isFetchingMore}
            isInfiniteMode={isInfiniteMode}
            isVirtualizationEnabled={isVirtualizationEnabled}
            loadingMoreMessage={loadingMoreMessage}
            measureRowRef={measureRowRef}
            table={table}
            topRows={topRows}
            totalSize={totalSize}
            virtualItems={virtualItems}
          />
        </DataGridTableBody>

        {footerContent && (
          <DataGridTableFoot>{footerContent}</DataGridTableFoot>
        )}
      </DataGridTableBase>
    </DataGridTableViewport>
  );
}

export type {
  DataGridTableVirtualizerOptions,
  DataGridTableVirtualProps,
  DataGridTableVirtualScrollElements,
};
export { DataGridTableVirtual };
