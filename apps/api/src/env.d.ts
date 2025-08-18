declare module "bun" {
	type Env = {
		PORT: string;
		DATABASE_URL: string;
		REDIS_URL: string;
		BETTER_AUTH_SECRET: string;
		BETTER_AUTH_URL: string;
		FRONTEND_URL: string;
		DOCS_URL: string;
		CREDENTIAL_ENCRYPTION_KEY: string;
	};
}
