import { apiClient, callRpc } from "@/lib/api";
import { queryOptions } from "@tanstack/react-query";
import type { QueryOpts } from "@/qc/queries/base";
import { projectsBaseQueryKey } from "@/qc/queries/user";

export const webhooksListQueryKey = (projectId: string) =>
	[...projectsBaseQueryKey, projectId, "webhooks", "list"] as const;

export const webhooksListQueryOptions = (
	opts: QueryOpts<{ projectId: string }>,
) =>
	queryOptions({
		queryKey: webhooksListQueryKey(opts.query.projectId),
		queryFn: async () => {
			if (!opts.query.projectId) throw new Error("Project ID is required");

			const { data, error } = await callRpc(
				apiClient.webhooks[":projectId"].$get(
					{
						param: { projectId: opts.query.projectId },
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

export const singleWebhookQueryKey = (projectId: string, webhookId?: string) =>
	[...projectsBaseQueryKey, projectId, "webhooks", webhookId] as const;

export const singleWebhookQueryOptions = (
	opts: QueryOpts<{ projectId: string; webhookId: string }>,
) =>
	queryOptions({
		queryKey: singleWebhookQueryKey(opts.query.projectId, opts.query.webhookId),
		queryFn: async () => {
			if (!opts.query.projectId) throw new Error("Project ID is required");
			if (!opts.query.webhookId) throw new Error("Webhook ID is required");

			const { data, error } = await callRpc(
				apiClient.webhooks[":projectId"][":webhookId"].$get(
					{
						param: {
							projectId: opts.query.projectId,
							webhookId: opts.query.webhookId,
						},
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
