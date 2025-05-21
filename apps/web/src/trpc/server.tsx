import "server-only";

import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { cache } from "react";
import { makeQueryClient } from "./query-client";
import { httpLink } from "@trpc/client";
import { createTRPCClient } from "@trpc/react-query";
import superjson from "superjson";
import type { AppRouter } from "@repo/api";

export const getQueryClient = cache(makeQueryClient);

export const trpcClient = (headers?: Headers) =>
	createTRPCClient<AppRouter>({
		links: [
			httpLink({
				transformer: superjson,
				url: `${process.env.NEXT_PUBLIC_API_URL}/trpc`,
				headers,
				fetch(url, options) {
					return fetch(url, {
						...options,
						credentials: "include",
					});
				},
			}),
		],
	});

export const trpc = (headers?: Headers) =>
	createTRPCOptionsProxy<AppRouter>({
		client: trpcClient(headers),
		queryClient: getQueryClient,
	});
