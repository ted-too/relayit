declare module "bun" {
  interface Env {
    REDIS_URL: string;
    DATABASE_URL: string;

    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    ENCRYPTION_KEY_VERSION: string;
    CREDENTIAL_ENCRYPTION_KEY_V1: string;
    CREDENTIAL_ENCRYPTION_KEY_V2?: string;
    CREDENTIAL_ENCRYPTION_KEY_V3?: string;

    APP_URL: string;
    DOCS_URL?: string;

    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;

    BUNNY_S3_ENDPOINT: string;
    BUNNY_S3_REGION: string;
    BUNNY_S3_ACCESS_KEY_ID: string;
    BUNNY_S3_SECRET_ACCESS_KEY: string;
    BUNNY_S3_BUCKET: string;

    LOG_LEVEL?: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    ENABLE_DOCS?: "true";
  }
}
