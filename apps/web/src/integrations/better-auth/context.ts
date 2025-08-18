import { createAuthClient } from "@/integrations/better-auth/client";

export function getAuthContext() {
	const getAuthClient = () => {
		if (typeof window !== "undefined") {
			return createAuthClient();
		}

		try {
			const { getWebRequest } = require("@tanstack/react-start/server");
			const req = getWebRequest();
			return createAuthClient(req.headers.get("cookie"));
		} catch {
			return createAuthClient();
		}
	};

	return {
		get auth() {
			return getAuthClient();
		},
	};
}
