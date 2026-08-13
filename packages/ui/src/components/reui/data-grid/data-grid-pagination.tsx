import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react";
import { useDataGrid } from "@repo/ui/components/reui/data-grid/data-grid";
import { Button } from "@repo/ui/components/ui/coss/button";
import { Skeleton } from "@repo/ui/components/ui/coss/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/shad/select";
import { cn } from "@repo/ui/lib/utils";
import type React from "react";
import type { ReactNode } from "react";

interface DataGridPaginationProps {
  className?: string;
  ellipsisText?: string;
  info?: string;
  infoSkeleton?: ReactNode;
  more?: boolean;
  moreLimit?: number;
  nextPageLabel?: string;
  previousPageLabel?: string;
  rowsPerPageLabel?: string;
  sizes?: number[];
  sizesDescription?: string;
  sizesInfo?: string;
  sizesLabel?: string;
  sizesSkeleton?: ReactNode;
}

function DataGridPagination(props: DataGridPaginationProps): React.JSX.Element {
  const { table, recordCount, isLoading } = useDataGrid();

  const defaultProps: Partial<DataGridPaginationProps> = {
    sizes: [5, 10, 25, 50, 100],
    sizesSkeleton: <Skeleton className="h-8 w-44" />,
    moreLimit: 5,
    info: "{from} - {to} of {count}",
    infoSkeleton: <Skeleton className="h-8 w-60" />,
    rowsPerPageLabel: "Rows per page",
    previousPageLabel: "Go to previous page",
    nextPageLabel: "Go to next page",
    ellipsisText: "...",
  };

  const mergedProps: DataGridPaginationProps = { ...defaultProps, ...props };

  const btnBaseClasses = "p-0 text-sm";
  const btnArrowClasses = `${btnBaseClasses} rtl:transform rtl:rotate-180`;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const from = recordCount === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, recordCount);
  const pageCount = table.getPageCount();

  // Replace placeholders in paginationInfo
  const paginationInfo = mergedProps.info
    ? mergedProps.info
        .replaceAll("{from}", from.toString())
        .replaceAll("{to}", to.toString())
        .replaceAll("{count}", recordCount.toString())
    : `${from} - ${to} of ${recordCount}`;

  // Pagination limit logic
  const paginationMoreLimit = mergedProps.moreLimit || 5;

  // Determine the start and end of the pagination group
  const currentGroupStart =
    Math.floor(pageIndex / paginationMoreLimit) * paginationMoreLimit;
  const currentGroupEnd = Math.min(
    currentGroupStart + paginationMoreLimit,
    pageCount
  );

  // Render page buttons based on the current group
  const renderPageButtons = () => {
    const buttons: React.ReactElement[] = [];
    for (let i = currentGroupStart; i < currentGroupEnd; i++) {
      buttons.push(
        <Button
          className={cn(btnBaseClasses, "text-muted-foreground", {
            "bg-accent text-accent-foreground": pageIndex === i,
          })}
          key={i}
          onClick={() => {
            if (pageIndex !== i) {
              table.setPageIndex(i);
            }
          }}
          size="icon-sm"
          variant="ghost"
        >
          {i + 1}
        </Button>
      );
    }
    return buttons;
  };

  // Render a "previous" ellipsis button if there are previous pages to show
  const renderEllipsisPrevButton = () => {
    if (currentGroupStart > 0) {
      return (
        <Button
          className={btnBaseClasses}
          onClick={() => table.setPageIndex(currentGroupStart - 1)}
          size="icon-sm"
          variant="ghost"
        >
          {mergedProps.ellipsisText}
        </Button>
      );
    }
    return null;
  };

  // Render a "next" ellipsis button if there are more pages to show after the current group
  const renderEllipsisNextButton = () => {
    if (currentGroupEnd < pageCount) {
      return (
        <Button
          className={btnBaseClasses}
          onClick={() => table.setPageIndex(currentGroupEnd)}
          size="icon-sm"
          variant="ghost"
        >
          {mergedProps.ellipsisText}
        </Button>
      );
    }
    return null;
  };

  return (
    <div
      className={cn(
        "flex grow flex-col flex-wrap items-center justify-between gap-2.5 py-2.5 sm:flex-row sm:py-0",
        mergedProps.className
      )}
      data-slot="data-grid-pagination"
    >
      <div className="order-2 flex flex-wrap items-center space-x-2.5 pb-2.5 sm:order-1 sm:pb-0">
        {isLoading ? (
          mergedProps.sizesSkeleton
        ) : (
          <>
            <div className="text-muted-foreground text-sm">
              {mergedProps.rowsPerPageLabel}
            </div>
            <Select
              onValueChange={(value) => {
                const newPageSize = Number(value);
                table.setPageSize(newPageSize);
              }}
              value={`${pageSize}`}
            >
              <SelectTrigger className="w-16" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="min-w-18" side="top">
                {mergedProps.sizes?.map((size: number) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      <div className="order-1 flex flex-col items-center justify-center gap-2.5 pt-2.5 sm:order-2 sm:flex-row sm:justify-end sm:pt-0">
        {isLoading ? (
          mergedProps.infoSkeleton
        ) : (
          <>
            <div className="order-2 text-nowrap text-muted-foreground text-sm sm:order-1">
              {paginationInfo}
            </div>
            {pageCount > 1 && (
              <div className="order-1 flex items-center space-x-1">
                <Button
                  className={btnArrowClasses}
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                  size="icon-sm"
                  variant="ghost"
                >
                  <span className="sr-only">
                    {mergedProps.previousPageLabel}
                  </span>
                  <RiArrowLeftSLine className="size-4" />
                </Button>

                {renderEllipsisPrevButton()}

                {renderPageButtons()}

                {renderEllipsisNextButton()}

                <Button
                  className={btnArrowClasses}
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                  size="icon-sm"
                  variant="ghost"
                >
                  <span className="sr-only">{mergedProps.nextPageLabel}</span>
                  <RiArrowRightSLine className="size-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { DataGridPagination, type DataGridPaginationProps };
