import { apiClient, callRpc } from "@/lib/api";
import { queryOptions } from "@tanstack/react-query";
import type { QueryOpts } from "@/qc/queries/base";
import { activeOrganizationQueryKey } from "@/qc/queries/user";
import { type GetProvidersQueryInput, stringifyObject } from "@repo/shared";
import type { InferResponseType } from "hono/client";

export const providersListQueryKey = [
	...activeOrganizationQueryKey,
	"providers-list",
] as const;

export const providersListQueryOptions = (
	opts?: QueryOpts<GetProvidersQueryInput>,
) =>
	queryOptions({
		queryKey: providersListQueryKey,
		queryFn: async () => {
			const { data, error } = await callRpc(
				apiClient.providers.$get(
					{
						query: stringifyObject(opts?.query),
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

export type Provider = InferResponseType<
	typeof apiClient.providers.$get
>[number];

export const singleProviderQueryKey = (providerId?: string) =>
	[...activeOrganizationQueryKey, "providers", providerId] as const;

export const singleProviderQueryOptions = (
	opts?: QueryOpts<{ providerId: string }>,
) =>
	queryOptions({
		queryKey: singleProviderQueryKey(opts?.query?.providerId),
		queryFn: async () => {
			if (!opts?.query?.providerId) throw new Error("Provider ID is required");

			const { data, error } = await callRpc(
				apiClient.providers[":providerId"].$get(
					{
						param: { providerId: opts.query.providerId },
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
