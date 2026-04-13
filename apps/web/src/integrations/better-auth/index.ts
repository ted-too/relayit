import { COOKIE_PREFIX } from "@repo/api/server/lib/auth/constants";

export * from "./client";

export const AUTH_COOKIES = [
  `${COOKIE_PREFIX}.session_token`,
  `__Secure-${COOKIE_PREFIX}.session_token`,
];
