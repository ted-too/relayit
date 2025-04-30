import { authClient } from "@/lib/auth-client";
import { queryOptions } from "@tanstack/react-query";

type QueryOpts<T = void> = {
	headers?: Headers;
	retry?: number;
	enabled?: boolean;
} & (T extends void ? {} : { query: T });

export const sessionQueryKey = ["session"];

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
					: undefined,
			);
			if (error) return Promise.reject(error);
			return data;
		},
		staleTime: 15 * 60 * 1000,
	});

export const userOrganizationsQueryKey = [
	"organizations",
	"current-user",
] as const;

export const userOrganizationsQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: userOrganizationsQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.organization.list({
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});
			if (error) return Promise.reject(error);
			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const userTeamsQueryKey = [
	"organizations",
	"current-user",
	"teams",
] as const;

export const userTeamsQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: userTeamsQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.organization.listTeams({
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});
			if (error) return Promise.reject(error);
			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const organizationQueryKey = [
	"organizations",
	"current-user",
	"organization",
] as const;

export const organizationQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: organizationQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.organization.getFullOrganization(
				{
					fetchOptions: {
						headers: Object.fromEntries(opts?.headers ?? []),
					},
				},
			);
			if (error) return Promise.reject(error);
			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const invitationsListQueryKey = [
	"organizations",
	"current-user",
	"invitations",
] as const;

export const invitationsListQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: invitationsListQueryKey,
		queryFn: async () => {
			const { data, error } = await authClient.organization.listInvitations({
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});
			if (error) return Promise.reject(error);
			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const singleInvitationQueryKey = (id?: string) =>
	["organizations", "current-user", "invitations", id] as const;

export const singleInvitationQueryOptions = (
	opts?: QueryOpts<{ id: string }>,
) =>
	queryOptions({
		queryKey: singleInvitationQueryKey(opts?.query?.id),
		queryFn: async () => {
			if (!opts?.query?.id) throw new Error("Invitation ID is required");

			const { data, error } = await authClient.organization.getInvitation({
				query: {
					id: opts.query.id,
				},
				fetchOptions: {
					headers: Object.fromEntries(opts?.headers ?? []),
				},
			});

			if (error) return Promise.reject(error);

			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});
