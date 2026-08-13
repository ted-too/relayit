import { createAuthClient } from "@repo/persistence/auth/client";

export const authClient = createAuthClient({
  // biome-ignore lint/correctness/noUndeclaredVariables: this is a vite constant
  baseURL: __BASE_URL__,
});
