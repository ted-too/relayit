import type { AppType } from "@repo/api";
import { type ClientResponse, hc } from "hono/client";

export const apiClient = hc<AppType>(process.env.NEXT_PUBLIC_API_URL, {
	fetch: ((input, init) => {
		return fetch(input, {
			...init,
			credentials: "include",
		});
	}) as typeof fetch,
});

export type ErrorResponse = {
	message: string;
	details: string[];
};

export const callRpc = async <T>(
	rpc: Promise<ClientResponse<T>>,
): Promise<{ data: T; error: null } | { data: null; error: ErrorResponse }> => {
	try {
		const data = await rpc;

		if (!data.ok) {
			const res = (await data.json()) as ErrorResponse;
			return { data: null, error: res };
		}

		const res = await data.json();
		return { data: res as T, error: null };
	} catch (error) {
		return {
			data: null,
			error: {
				message: "Something went wrong",
				details: [(error as Error).message],
			},
		};
	}
};
