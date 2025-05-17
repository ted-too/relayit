import { apiClient, callRpc } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { getOrganizationMetadata } from "@/lib/utils";
import { queryOptions } from "@tanstack/react-query";
import { sessionQueryKey, type QueryOpts } from "@/qc/queries/base";
import type { InferResponseType } from "hono/client";

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
				},
			);
			if (error) return Promise.reject(error);

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
			if (error) return Promise.reject(error);
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
			if (error) return Promise.reject(error);
			return data;
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

export const projectsBaseQueryKey = [
	...activeOrganizationQueryKey,
	"projects",
] as const;

export const projectsQueryKey = [...projectsBaseQueryKey, "list"] as const;

export const projectsQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: projectsQueryKey,
		queryFn: async () => {
			const { data, error } = await callRpc(
				apiClient.projects.$get(
					{},
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

export type Project = InferResponseType<typeof apiClient.projects.$get>[number];

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
			if (error) return Promise.reject(error);

			return data.map((org) => ({
				...org,
				metadata: getOrganizationMetadata(org.metadata),
			}));
		},
		retry: opts?.retry,
		enabled: opts?.enabled,
	});

// TODO: This might need to be fixed as it lists all invitations for the organization
export const usersInvitationsListQueryKey = [
	...sessionQueryKey,
	"invitations-list",
] as const;

export const usersInvitationsListQueryOptions = (opts?: QueryOpts) =>
	queryOptions({
		queryKey: usersInvitationsListQueryKey,
		queryFn: async () => {
			const { data, error } = await callRpc(
				apiClient.invitations.$get(
					{},
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

export const userInvitationQueryKey = (id?: string) =>
	[...sessionQueryKey, "invitation", id] as const;

export const userInvitationQueryOptions = (opts?: QueryOpts<{ id: string }>) =>
	queryOptions({
		queryKey: userInvitationQueryKey(opts?.query?.id),
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
