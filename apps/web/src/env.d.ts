declare namespace NodeJS {
	interface ProcessEnv {
		NEXT_PUBLIC_API_URL: string;
		NEXT_PUBLIC_FRONTEND_URL: string;
		CAN_IMPERSONATE?: string;
	}
}
