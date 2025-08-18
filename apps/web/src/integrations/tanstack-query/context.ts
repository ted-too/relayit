import { QueryClient } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";
import { createTrpcClient } from "@/integrations/trpc/client";

export function getContext() {
	const queryClient = new QueryClient({
		defaultOptions: {
			dehydrate: { serializeData: superjson.serialize },
			hydrate: { deserializeData: superjson.deserialize },
		},
	});

	const getServerHelpers = () => {
		const trpcClient = (() => {
			if (typeof window !== "undefined") {
				return createTrpcClient();
			}

			try {
				const { getWebRequest } = require("@tanstack/react-start/server");
				const req = getWebRequest();
				return createTrpcClient(req.headers.get("cookie"));
			} catch {
				return createTrpcClient();
			}
		})();

		return createTRPCOptionsProxy({
			client: trpcClient,
			queryClient,
		});
	};

	return {
		queryClient,
		get trpc() {
			return getServerHelpers();
		},
	};
}
