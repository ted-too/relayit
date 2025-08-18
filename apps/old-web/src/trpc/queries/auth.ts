import { queryOptions } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { getOrganizationMetadata } from "@/lib/utils";

export type QueryOpts<T = void> = {
	headers?: Headers;
	retry?: number;
	enabled?: boolean;
} & (T extends void ? {} : { query: T });

export const sessionQueryKey = ["current-user", "session"] as const;

export const sessionQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: sessionQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.getSession(
				opts?.headers
					? {
							fetchOptions: {
								headers: Object.fromEntries(opts.headers ?? []),
							},
						}
					: undefined
			);
			if (error) {
				return Promise.reject(error);
			}
			return data;
		},
		staleTime: 15 * 60 * 1000,
	});

export const activeOrganizationQueryKey = [
	...sessionQueryKey,
	"active-organization",
] as const;

export const activeOrganizationQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: activeOrganizationQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.organization.getFullOrganization(
				{
					fetchOptions: {
						headers: Object.fromEntries(opts?.headers ?? []),
					},
				}
			);
			if (error) {
				return Promise.reject(error);
			}

			return {
				...data,
				metadata: getOrganizationMetadata(data.metadata),
			};
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const apiKeysListQueryKey = [
	...activeOrganizationQueryKey,
	"api-keys",
] as const;

export const apiKeysListQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: apiKeysListQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.apiKey.list({
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});
			if (error) {
				return Promise.reject(error);
			}
			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const currentMemberQueryKey = [
	...activeOrganizationQueryKey,
	"current-member",
] as const;

export const currentMemberQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: currentMemberQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.organization.getActiveMember({
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});
			if (error) {
				return Promise.reject(error);
			}
			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const usersOrganizationsQueryKey = [
	...sessionQueryKey,
	"users-organizations-list",
] as const;

export const usersOrganizationsQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: usersOrganizationsQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.organization.list({
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});
			if (error) {
				return Promise.reject(error);
			}

			return data.map((org) => ({
				...org,
				metadata: getOrganizationMetadata(org.metadata),
			}));
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const userInvitationQueryKey = (id?: string) =>
	[...sessionQueryKey, "invitation", id] as const;

export const userInvitationQueryOptions = (opts?: QueryOpts<{ id: string }>) =>
	queryOptions({
		queryKey: userInvitationQueryKey(opts?.query?.id),
		queryFn: async () => {
			if (!opts?.query?.id) {
				throw new Error("Invitation ID is required");
			}

			const { data, error } = await authClient.organization.getInvitation({
				query: {
					id: opts.query.id,
				},
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});

			if (error) {
				return Promise.reject(error);
			}

			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});
