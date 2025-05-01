import { apiClient, callRpc } from "@/lib/api";
import {
	type GetProjectMessagesQueryInput,
	stringifyObject,
} from "@repo/shared";
import { queryOptions } from "@tanstack/react-query";
import type { QueryOpts } from "@/qc/queries/base";

export type MessagesListQueryParams = GetProjectMessagesQueryInput & {
	projectId: string;
};

export const messagesListQueryKey = (params: MessagesListQueryParams) =>
	["projects", params.projectId, "messages", params] as const;

export const messagesListQueryOptions = (
	opts: QueryOpts<MessagesListQueryParams>,
) =>
	queryOptions({
		queryKey: messagesListQueryKey(opts.query),
		queryFn: async () => {
			const { projectId, ...queryParams } = opts.query;

			if (!projectId) {
				throw new Error("Project ID is required");
			}

			const { data, error } = await callRpc(
				apiClient.projects[":projectId"].messages.$get(
					{
						param: { projectId },
						query: stringifyObject(queryParams),
					},
					{
						headers: Object.fromEntries(opts?.headers ?? []),
					},
				),
			);

			if (error) return Promise.reject(error);

			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});
