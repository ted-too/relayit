"use client";

import { DataTableInfinite } from "@/components/data-table";
import * as React from "react";
import { columns } from "./columns";
import { filterFields as defaultFilterFields, sheetFields } from "./fields";
import { trpc } from "@/trpc/client";
import { useQueryStates } from "nuqs";
import { messagesQueryParsers } from "../parsers";
import type { Message } from "@repo/db";
import { keepPreviousData } from "@tanstack/react-query";

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
		},
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
			data={flatData}
			facets={facets}
			columns={columns}
			filterFields={filterFields}
			sheetFields={sheetFields}
			fetchNextPage={fetchNextPage}
			fetchPreviousPage={fetchPreviousPage}
			refetch={refetch}
			isFetching={isFetching}
			isLoading={isLoading}
			totalRows={totalRowCount}
			filterRows={totalFilteredRowCount}
			totalRowsFetched={totalFetched}
			getRowId={(row) => row.id}
			getRowSheetTitle="Message"
			searchParamsParser={messagesQueryParsers}
			controlsOpen={controlsOpen}
		/>
	);
}
