declare module "bun" {
  interface Env {
    VITE_API_URL: string;
    VITE_DOCS_URL: string;
    VITE_EDITION: "cloud" | "self-hosted";
    VITE_BASE_URL: string;
  }
}
