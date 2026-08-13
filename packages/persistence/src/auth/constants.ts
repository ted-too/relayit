export const ROLES = {
  admin: "admin",
  user: "user",
} as const;

export const COOKIE_PREFIX = "relayit";

export const AUTH_COOKIES = [
  `${COOKIE_PREFIX}.session_token`,
  `__Secure-${COOKIE_PREFIX}.session_token`,
  `${COOKIE_PREFIX}.session_data`,
  `__Secure-${COOKIE_PREFIX}.session_data`,
];
