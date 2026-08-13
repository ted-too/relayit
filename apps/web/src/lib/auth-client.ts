import { createAuthClient } from "@repo/persistence/auth/client";
import { env } from "@/env";

export const authClient = createAuthClient({
  baseURL: env.VITE_BASE_URL,
});
