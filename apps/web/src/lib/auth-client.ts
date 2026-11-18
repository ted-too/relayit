import { createAuthClient } from "@repo/persistence/auth/client";
import { API_ORIGIN } from "@/lib/api-origin";

export const authClient = createAuthClient(API_ORIGIN);
