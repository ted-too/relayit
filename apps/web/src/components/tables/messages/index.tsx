"use client";

import { DataTableInfinite } from "@/components/data-table";
import { useResetFocus } from "@/hooks/use-hot-key";
import { getFacetedMinMaxValues, getFacetedUniqueValues } from "@/lib/facets";
import * as React from "react";
import { columns } from "./columns";
import { filterFields as defaultFilterFields, sheetFields } from "./fields";
import { trpc } from "@/trpc/client";
import { useQueryStates } from "nuqs";
import { messagesQueryParsers } from "../parsers";
import { getMessagesQuerySchema } from "@repo/shared";

export function MessagesTable({ projectId }: { projectId?: string }) {
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
		},
	);

	const { flatData, totalFetched } = React.useMemo(() => {
		const flatData = data?.pages?.flatMap((page) => page.items ?? []) ?? [];

		return {
			flatData,
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

	useResetFocus();

	// const lastPage = data?.pages?.[data?.pages.length - 1];
	// const totalDBRowCount =
	// 	(lastPage?.meta?.pagination?.totalRowCount ?? 0) + liveRows.length;
	// const filterDBRowCount =
	// 	(lastPage?.meta?.pagination?.totalFilteredRowCount ?? 0) + liveRows.length;
	// const totalFetched = flatData?.length + liveRows.length;
	// const combinedData = [...liveRows, ...flatData];

	// const { sort, start, limit, end, interval, page, ...filter } = searchParams;

	// REMINDER: this is currently needed for the cmdk search
	const filterFields = React.useMemo(() => {
		return defaultFilterFields.map((field) => {
			const facetsField = facets?.[field.value];
			if (!facetsField) return field;
			if (field.options && field.options.length > 0) return field;

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
			schema={getMessagesQuerySchema}
			parsers={messagesQueryParsers}
			columns={columns}
			getRowId={(row) => row.id}
			data={flatData}
			defaultColumnFilters={Object.entries(searchParams)
				.map(([key, value]) => ({
					id: key,
					value,
				}))
				.filter(({ value }) => value ?? undefined)}
			defaultRowSelection={
				searchParams.id ? { [searchParams.id]: true } : undefined
			}
			defaultColumnVisibility={{
				id: false,
			}}
			filterFields={filterFields}
			sheetFields={sheetFields}
			getFacetedUniqueValues={getFacetedUniqueValues(facets)}
			getFacetedMinMaxValues={getFacetedMinMaxValues(facets)}
			totalRows={totalRowCount}
			filterRows={totalFilteredRowCount}
			totalRowsFetched={totalFetched}
			isFetching={isFetching}
			isLoading={isLoading}
			fetchNextPage={fetchNextPage}
			fetchPreviousPage={fetchPreviousPage}
			refetch={refetch}
			sheetTitle="Message"
		/>
	);
}
