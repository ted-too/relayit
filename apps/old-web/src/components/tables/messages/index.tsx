"use client";

import type { Message } from "@repo/db";
import { keepPreviousData } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import * as React from "react";
import { DataTableInfinite } from "@/components/data-table";
import { trpc } from "@/trpc/client";
import { messagesQueryParsers } from "../parsers";
import { columns } from "./columns";
import { filterFields as defaultFilterFields, sheetFields } from "./fields";

export function MessagesTable({
	projectId,
	controlsOpen,
}: {
	projectId?: string;
	controlsOpen?: boolean;
}) {
	const [searchParams] = useQueryStates(messagesQueryParsers);
	const {
		data,
		isFetching,
		isLoading,
		fetchNextPage,
		fetchPreviousPage,
		refetch,
	} = trpc.messages.list.useInfiniteQuery(
		{ ...searchParams, projectId },
		{
			getNextPageParam: (lastPage) => lastPage.nextCursor,
			placeholderData: keepPreviousData,
		}
	);

	const { flatData, totalFetched } = React.useMemo(() => {
		const flatData = data?.pages?.flatMap((page) => page.items ?? []) ?? [];

		return {
			flatData: flatData as Message[],
			totalFetched: flatData.length,
		};
	}, [data?.pages]);

	const { facets, totalRowCount, totalFilteredRowCount } = React.useMemo(() => {
		const lastPage = data?.pages?.[data?.pages.length - 1];
		return {
			facets: lastPage?.facets ?? {},
			totalRowCount: lastPage?.totalRowCount ?? 0,
			totalFilteredRowCount: lastPage?.totalFilteredRowCount ?? 0,
		};
	}, [data?.pages]);

	// REMINDER: this is currently needed for the cmdk search
	const filterFields = React.useMemo(() => {
		return defaultFilterFields.map((field) => {
			const facetsField = facets?.[field.value];
			if (!facetsField) {
				return field;
			}
			if (field.options && field.options.length > 0) {
				return field;
			}

			const options = facetsField.rows.map(({ value }) => {
				return {
					label: `${value}`,
					value,
				};
			});

			return { ...field, options };
		});
	}, [facets]);

	return (
		<DataTableInfinite
			columns={columns}
			controlsOpen={controlsOpen}
			data={flatData}
			defaultColumnVisibility={
				projectId
					? {
							project: false,
						}
					: undefined
			}
			facets={facets}
			fetchNextPage={fetchNextPage}
			fetchPreviousPage={fetchPreviousPage}
			filterFields={filterFields}
			filterRows={totalFilteredRowCount}
			getRowId={(row) => row.id}
			getRowSheetTitle="Message"
			isFetching={isFetching}
			isLoading={isLoading}
			refetch={refetch}
			searchParamsParser={messagesQueryParsers}
			sheetFields={sheetFields}
			tableId={`messages-table-${projectId ?? "all"}`}
			totalRows={totalRowCount}
			totalRowsFetched={totalFetched}
		/>
	);
}
