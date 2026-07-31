import {
  RiArrowDownLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiArrowUpLine,
  RiCheckLine,
  RiContractLeftLine,
  RiContractRightLine,
  RiEqualizer2Line,
  RiExpandUpDownLine,
  RiUnpinLine,
} from "@remixicon/react";
import {
  getColumnHeaderLabel,
  useDataGrid,
} from "@repo/ui/components/reui/data-grid/data-grid";
import { Button } from "@repo/ui/components/ui/coss/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/components/ui/coss/menu";
import { cn } from "@repo/ui/lib/utils";
import type { Column } from "@tanstack/react-table";
import { type HTMLAttributes, memo, type ReactNode, useMemo } from "react";

interface DataGridColumnHeaderProps<TData, TValue>
  extends HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  filter?: ReactNode;
  icon?: ReactNode;
  /** Reserved; pin controls are gated by tableLayout.columnsPinnable + column.getCanPin(). */
  pinnable?: boolean;
  /** When omitted, uses `column.columnDef.meta.headerTitle`, then a string `columnDef.header`, then `column.id`. */
  title?: string;
  visibility?: boolean;
}

function DataGridColumnHeaderInner<TData, TValue>({
  column,
  title,
  icon,
  className,
  filter,
  visibility = false,
}: DataGridColumnHeaderProps<TData, TValue>) {
  const { isLoading, table, props, recordCount } = useDataGrid();
  const resolvedTitle = title ?? getColumnHeaderLabel(column);

  const columnOrder = table.getState().columnOrder;
  const _columnVisibilityKey =
    props.tableLayout?.columnsVisibility && visibility
      ? JSON.stringify(table.getState().columnVisibility)
      : "";
  const isSorted = column.getIsSorted();
  const isPinned = column.getIsPinned();
  const canSort = column.getCanSort();
  const canPin = column.getCanPin();
  const canResize = column.getCanResize();

  const columnIndex = columnOrder.indexOf(column.id);
  const canMoveLeft = columnIndex > 0;
  const canMoveRight = columnIndex < columnOrder.length - 1;

  const handleSort = () => {
    if (isSorted === "asc") {
      column.toggleSorting(true);
    } else if (isSorted === "desc") {
      column.clearSorting();
    } else {
      column.toggleSorting(false);
    }
  };

  const headerLabelClassName = cn(
    "inline-flex h-full items-center gap-1.5 font-normal text-[0.8125rem] text-secondary-foreground/80 leading-[calc(1.125/0.8125)] [&_svg]:size-3.5 [&_svg]:opacity-60",
    className
  );

  const headerButtonClassName = cn(
    "h-6 rounded-md px-2 font-normal text-secondary-foreground/80 hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground",
    className
  );

  const sortIcon =
    canSort &&
    (isSorted === "desc" ? (
      <RiArrowDownLine aria-hidden="true" className="size-3.25" />
    ) : isSorted === "asc" ? (
      <RiArrowUpLine aria-hidden="true" className="size-3.25" />
    ) : (
      <RiExpandUpDownLine aria-hidden="true" className="mt-px size-3.25" />
    ));

  const hasControls =
    props.tableLayout?.columnsMovable ||
    (props.tableLayout?.columnsVisibility && visibility) ||
    (props.tableLayout?.columnsPinnable && canPin) ||
    filter;

  const menuItems = useMemo(() => {
    const items: ReactNode[] = [];
    let hasPreviousSection = false;

    // Filter section
    if (filter) {
      items.push(
        <DropdownMenuGroup key="group-filter">
          <DropdownMenuLabel key="filter">{filter}</DropdownMenuLabel>
        </DropdownMenuGroup>
      );
      hasPreviousSection = true;
    }

    // Sort section
    if (canSort) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-sort" />);
      }
      items.push(
        <DropdownMenuItem
          disabled={!canSort}
          key="sort-asc"
          onClick={() => {
            if (isSorted === "asc") {
              column.clearSorting();
            } else {
              column.toggleSorting(false);
            }
          }}
        >
          <RiArrowUpLine className="size-3.5!" />
          <span className="grow">Asc</span>
          {isSorted === "asc" && (
            <RiCheckLine className="size-4 text-primary opacity-100!" />
          )}
        </DropdownMenuItem>,
        <DropdownMenuItem
          disabled={!canSort}
          key="sort-desc"
          onClick={() => {
            if (isSorted === "desc") {
              column.clearSorting();
            } else {
              column.toggleSorting(true);
            }
          }}
        >
          <RiArrowDownLine className="size-3.5!" />
          <span className="grow">Desc</span>
          {isSorted === "desc" && (
            <RiCheckLine className="size-4 text-primary opacity-100!" />
          )}
        </DropdownMenuItem>
      );
      hasPreviousSection = true;
    }

    // Pin section
    if (props.tableLayout?.columnsPinnable && canPin) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-pin" />);
      }
      items.push(
        <DropdownMenuItem
          key="pin-left"
          onClick={() => column.pin(isPinned === "left" ? false : "left")}
        >
          <RiContractLeftLine aria-hidden="true" className="size-3.5!" />
          <span className="grow">Pin to left</span>
          {isPinned === "left" && (
            <RiCheckLine className="size-4 text-primary opacity-100!" />
          )}
        </DropdownMenuItem>,
        <DropdownMenuItem
          key="pin-right"
          onClick={() => column.pin(isPinned === "right" ? false : "right")}
        >
          <RiContractRightLine aria-hidden="true" className="size-3.5!" />
          <span className="grow">Pin to right</span>
          {isPinned === "right" && (
            <RiCheckLine className="size-4 text-primary opacity-100!" />
          )}
        </DropdownMenuItem>
      );
      hasPreviousSection = true;
    }

    // Move section
    if (props.tableLayout?.columnsMovable) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-move" />);
      }
      items.push(
        <DropdownMenuItem
          disabled={!canMoveLeft || isPinned !== false}
          key="move-left"
          onClick={() => {
            if (columnIndex > 0) {
              const newOrder = [...columnOrder];
              const [movedColumn] = newOrder.splice(columnIndex, 1);
              newOrder.splice(columnIndex - 1, 0, movedColumn);
              table.setColumnOrder(newOrder);
            }
          }}
        >
          <RiArrowLeftLine aria-hidden="true" className="size-3.5!" />
          <span>Move to Left</span>
        </DropdownMenuItem>,
        <DropdownMenuItem
          disabled={!canMoveRight || isPinned !== false}
          key="move-right"
          onClick={() => {
            if (columnIndex < columnOrder.length - 1) {
              const newOrder = [...columnOrder];
              const [movedColumn] = newOrder.splice(columnIndex, 1);
              newOrder.splice(columnIndex + 1, 0, movedColumn);
              table.setColumnOrder(newOrder);
            }
          }}
        >
          <RiArrowRightLine aria-hidden="true" className="size-3.5!" />
          <span>Move to Right</span>
        </DropdownMenuItem>
      );
      hasPreviousSection = true;
    }

    // Visibility section
    if (props.tableLayout?.columnsVisibility && visibility) {
      if (hasPreviousSection) {
        items.push(<DropdownMenuSeparator key="sep-visibility" />);
      }
      items.push(
        <DropdownMenuSub key="visibility">
          <DropdownMenuSubTrigger>
            <RiEqualizer2Line className="size-3.5!" />
            <span>Columns</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent side="right">
            {table
              .getAllColumns()
              .filter((col) => col.getCanHide())
              .map((col) => (
                <DropdownMenuCheckboxItem
                  checked={col.getIsVisible()}
                  className="capitalize"
                  key={col.id}
                  onCheckedChange={(value) => col.toggleVisibility(!!value)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {getColumnHeaderLabel(col)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filter,
    canSort,
    isSorted,
    column,
    props.tableLayout?.columnsPinnable,
    props.tableLayout?.columnsMovable,
    props.tableLayout?.columnsVisibility,
    canPin,
    isPinned,
    canMoveLeft,
    canMoveRight,
    visibility,
    table,
    columnIndex,
    columnOrder,
  ]);

  if (hasControls) {
    return (
      <div className="-ms-2 flex h-full items-center justify-between gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className={headerButtonClassName}
                disabled={isLoading || recordCount === 0}
                variant="ghost"
              >
                {icon && icon}
                {resolvedTitle}
                {sortIcon}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-40">
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
        {props.tableLayout?.columnsPinnable && canPin && isPinned && (
          <Button
            aria-label={`Unpin ${resolvedTitle} column`}
            className="-me-1 size-7 rounded-md"
            onClick={() => column.pin(false)}
            size="icon-sm"
            title={`Unpin ${resolvedTitle} column`}
            variant="ghost"
          >
            <RiUnpinLine aria-hidden="true" className="size-3.5! opacity-50!" />
          </Button>
        )}
      </div>
    );
  }

  if (canSort || (props.tableLayout?.columnsResizable && canResize)) {
    return (
      <div className="-ms-2 flex h-full items-center">
        <Button
          className={headerButtonClassName}
          disabled={isLoading || recordCount === 0}
          onClick={handleSort}
          variant="ghost"
        >
          {icon && icon}
          {resolvedTitle}
          {sortIcon}
        </Button>
      </div>
    );
  }

  return (
    <div className={headerLabelClassName}>
      {icon && icon}
      {resolvedTitle}
    </div>
  );
}

const DataGridColumnHeader = memo(
  DataGridColumnHeaderInner
) as typeof DataGridColumnHeaderInner;

export { DataGridColumnHeader, type DataGridColumnHeaderProps };
