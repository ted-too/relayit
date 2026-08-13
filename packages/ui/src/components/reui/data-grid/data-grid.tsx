import { cn } from "@repo/ui/lib/utils";
import type {
  Column,
  ColumnFiltersState,
  RowData,
  SortingState,
  Table,
} from "@tanstack/react-table";
import { createContext, type ReactNode, useContext, useMemo } from "react";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Expands the column to fill remaining table width after fixed-size columns. */
    autoSize?: boolean;
    cellClassName?: string;
    expandedContent?: (row: TData) => ReactNode;
    headerClassName?: string;
    headerTitle?: string;
    skeleton?: ReactNode;
  }
}

/** Label for headers / column visibility: `meta.headerTitle`, string `columnDef.header`, or `column.id`. */
export function getColumnHeaderLabel<TData, TValue>(
  column: Column<TData, TValue>
): string {
  const meta = column.columnDef.meta as { headerTitle?: string } | undefined;
  if (typeof meta?.headerTitle === "string") {
    return meta.headerTitle;
  }
  const defHeader = column.columnDef.header;
  if (typeof defHeader === "string") {
    return defHeader;
  }
  return String(column.id);
}

export interface DataGridApiFetchParams {
  filters?: ColumnFiltersState;
  pageIndex: number;
  pageSize: number;
  searchQuery?: string;
  sorting?: SortingState;
}

export interface DataGridApiResponse<T> {
  data: T[];
  empty: boolean;
  pagination: {
    total: number;
    page: number;
  };
}

export interface DataGridContextProps<TData extends object> {
  isLoading: boolean;
  props: DataGridProps<TData>;
  recordCount: number;
  table: Table<TData>;
}

export interface DataGridRequestParams {
  columnFilters?: ColumnFiltersState;
  pageIndex: number;
  pageSize: number;
  sorting?: SortingState;
}

export interface DataGridProps<TData extends object> {
  allRowsLoadedMessage?: ReactNode | string;
  children?: ReactNode;
  className?: string;
  /**
   * Row data bound to `table`. Pass this when using a stable `useReactTable`
   * instance so the grid re-renders when cell values change without the row
   * count changing.
   */
  data?: readonly TData[];
  emptyMessage?: ReactNode | string;
  fetchingMoreMessage?: ReactNode | string;
  isLoading?: boolean;
  loadingMessage?: ReactNode | string;
  loadingMode?: "skeleton" | "spinner";
  onRowClick?: (row: TData) => void;
  recordCount: number;
  table?: Table<TData>;
  tableClassNames?: {
    base?: string;
    header?: string;
    headerRow?: string;
    headerSticky?: string;
    body?: string;
    bodyRow?: string;
    footer?: string;
    edgeCell?: string;
  };
  tableLayout?: {
    dense?: boolean;
    cellBorder?: boolean;
    rowBorder?: boolean;
    rowRounded?: boolean;
    stripped?: boolean;
    headerBackground?: boolean;
    footerBackground?: boolean;
    headerBorder?: boolean;
    headerSticky?: boolean;
    width?: "auto" | "fixed";
    columnsVisibility?: boolean;
    columnsResizable?: boolean;
    columnsResizeMode?: "onChange" | "onEnd";
    columnsPinnable?: boolean;
    columnsMovable?: boolean;
    columnsDraggable?: boolean;
    rowsDraggable?: boolean;
    rowsPinnable?: boolean;
  };
}

const DataGridContext = createContext<
  // biome-ignore lint/suspicious/noExplicitAny: shared context must erase row generics
  DataGridContextProps<any> | undefined
>(undefined);

function useDataGrid() {
  const context = useContext(DataGridContext);
  if (!context) {
    throw new Error("useDataGrid must be used within a DataGridProvider");
  }
  return context;
}

function DataGridProvider<TData extends object>({
  children,
  table,
  ...props
}: DataGridProps<TData> & { table: Table<TData> }) {
  const resolvedColumnsResizeMode =
    props.tableLayout?.columnsResizeMode ?? "onEnd";

  // Keep resize mode aligned with the DataGrid contract every render so
  // consumer-level useReactTable options cannot flip it back between drags.
  if (props.tableLayout?.columnsResizable) {
    table.options.columnResizeMode = resolvedColumnsResizeMode;
  }

  const rowData = props.data ?? table.options.data;

  // Memoize context value so consumers don't re-render during column resize.
  // Column sizing state is intentionally excluded from deps -- CSS variables
  // on the <table> element handle width updates without React re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: omit full `props` (new object each render); list stable fields instead
  const value = useMemo(
    () => ({
      props,
      table,
      recordCount: props.recordCount,
      isLoading: props.isLoading ?? false,
    }),
    [
      table,
      rowData,
      props.recordCount,
      props.isLoading,
      props.loadingMode,
      props.loadingMessage,
      props.fetchingMoreMessage,
      props.allRowsLoadedMessage,
      props.emptyMessage,
      props.onRowClick,
      props.className,
      props.tableLayout,
      props.tableClassNames,
    ]
  );

  return (
    <DataGridContext.Provider value={value}>
      {children}
    </DataGridContext.Provider>
  );
}

function DataGrid<TData extends object>({
  children,
  table,
  ...props
}: DataGridProps<TData>) {
  const defaultProps: Partial<DataGridProps<TData>> = {
    loadingMode: "skeleton",
    tableLayout: {
      dense: false,
      cellBorder: false,
      rowBorder: true,
      rowRounded: false,
      stripped: false,
      headerSticky: false,
      headerBackground: false,
      footerBackground: false,
      headerBorder: true,
      width: "fixed",
      columnsVisibility: false,
      columnsResizable: false,
      columnsResizeMode: "onEnd",
      columnsPinnable: false,
      columnsMovable: false,
      columnsDraggable: false,
      rowsDraggable: false,
      rowsPinnable: false,
    },
    tableClassNames: {
      base: "",
      header: "",
      headerRow: "",
      headerSticky: "sticky top-0 z-15 bg-background/90 backdrop-blur-xs",
      body: "",
      bodyRow: "",
      footer: "",
      edgeCell: "",
    },
  };

  const mergedProps: DataGridProps<TData> = {
    ...defaultProps,
    ...props,
    tableLayout: {
      ...defaultProps.tableLayout,
      ...(props.tableLayout || {}),
    },
    tableClassNames: {
      ...defaultProps.tableClassNames,
      ...(props.tableClassNames || {}),
    },
  };

  // Ensure table is provided
  if (!table) {
    throw new Error('DataGrid requires a "table" prop');
  }

  return (
    <DataGridProvider table={table} {...mergedProps}>
      {children}
    </DataGridProvider>
  );
}

function DataGridContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  border?: boolean;
}) {
  return (
    <div
      className={cn("w-full overflow-hidden", className)}
      data-slot="data-grid"
    >
      {children}
    </div>
  );
}

export { DataGrid, DataGridContainer, DataGridProvider, useDataGrid };
