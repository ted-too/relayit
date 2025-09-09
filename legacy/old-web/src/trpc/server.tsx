import "server-only";

import type { AppRouter } from "@repo/api";
import { httpLink } from "@trpc/client";
import { createTRPCClient } from "@trpc/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { cache } from "react";
import superjson from "superjson";
import { makeQueryClient } from "./query-client";

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
