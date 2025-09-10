declare module "bun" {
  interface Env {
    REDIS_URL: string;
    DATABASE_URL: string;

    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    CREDENTIAL_ENCRYPTION_KEY: string;

    APP_URL: string;
    DOCS_URL?: string;

    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;

    LOG_LEVEL?: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  }
}
