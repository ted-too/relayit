import { authClient } from "@/lib/auth-client";
import { queryOptions } from "@tanstack/react-query";

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
					: undefined,
			);
			if (error) return Promise.reject(error);
			return data;
		},
		staleTime: 15 * 60 * 1000,
	});
