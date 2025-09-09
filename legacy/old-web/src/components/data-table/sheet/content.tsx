"use client";

import { cn } from "@repo/old-ui/lib/utils";
import type { Table } from "@tanstack/react-table";
import * as React from "react";
import type {
	DataTableFilterField,
	SheetField,
} from "@/components/data-table/types";
import { DataTableSheetRowAction } from "./row-action";
import { SheetDetailsContentSkeleton } from "./skeleton";

interface DataTableSheetContentProps<TData, TMeta>
	extends React.HTMLAttributes<HTMLDListElement> {
	data?: TData;
	table: Table<TData>;
	fields: SheetField<TData, TMeta>[];
	filterFields: DataTableFilterField<TData>[];
	metadata?: TMeta & {
		totalRows: number;
		filterRows: number;
		totalRowsFetched: number;
	};
}

export function DataTableSheetContent<TData, TMeta>({
	data,
	table,
	className,
	fields,
	filterFields,
	metadata,
	...props
}: DataTableSheetContentProps<TData, TMeta>) {
	if (!data) {
		return <SheetDetailsContentSkeleton fields={fields} />;
	}

	return (
		<dl className={cn("divide-y", className)} {...props}>
			{fields.map((field) => {
				if (field.condition && !field.condition(data)) {
					return null;
				}

				const Component = field.component;
				const value = String(data[field.id]);

				return (
					<div key={field.id.toString()}>
						{field.type === "readonly" ? (
							<div
								className={cn(
									"my-1 flex w-full items-center justify-between gap-4 py-1 text-sm",
									field.className
								)}
							>
								<dt className="shrink-0 text-muted-foreground">
									{field.label}
								</dt>
								<dd className="w-full text-right font-mono">
									{Component ? (
										<Component {...data} metadata={metadata} />
									) : (
										value
									)}
								</dd>
							</div>
						) : (
							<DataTableSheetRowAction
								className={cn(
									"my-1 flex w-full items-center justify-between gap-4 py-1 text-sm",
									field.className
								)}
								fieldValue={field.id}
								filterFields={filterFields}
								table={table}
								value={value}
							>
								<dt className="shrink-0 text-muted-foreground">
									{field.label}
								</dt>
								<dd className="w-full text-right font-mono">
									{Component ? (
										<Component {...data} metadata={metadata} />
									) : (
										value
									)}
								</dd>
							</DataTableSheetRowAction>
						)}
					</div>
				);
			})}
		</dl>
	);
}

export const MemoizedDataTableSheetContent = React.memo(
	DataTableSheetContent,
	(prev, next) => {
		// REMINDER: only check if data is the same, rest is useless
		return prev.data === next.data;
	}
) as typeof DataTableSheetContent;
