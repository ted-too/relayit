import {
	apiKeyClient,
	organizationClient,
	passkeyClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { getUrl } from "@/integrations/trpc/client";

export const createAuthClient = (cookie?: string | null) =>
	createBetterAuthClient({
		baseURL: getUrl(),
		plugins: [apiKeyClient(), organizationClient(), passkeyClient()],
		fetchOptions: {
			credentials: "include",
			headers: cookie ? { cookie } : undefined,
		},
	});

export type AuthClient = ReturnType<typeof createAuthClient>;
