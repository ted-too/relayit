import { apiKeyClient } from "@better-auth/api-key/client";
import { BASE_PATH, COOKIE_PREFIX } from "@repo/api/server/lib/auth/constants";
import {
  ac,
  admin,
  member,
  owner,
  type statement,
} from "@repo/api/server/lib/auth/permissions";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import {
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { env } from "@/env";

const createClient = ({
  Cookie,
  baseURL,
}: {
  Cookie?: string;
  baseURL: string;
}) =>
  createBetterAuthClient({
    baseURL,
    basePath: BASE_PATH,
    plugins: [
      organizationClient({
        ac,
        roles: {
          owner,
          admin,
          member,
        },
      }),
      lastLoginMethodClient(),
      apiKeyClient(),
    ],
    fetchOptions: Cookie
      ? {
          headers: { Cookie },
        }
      : undefined,
  });

export const createAuthClient = createIsomorphicFn()
  .server(() => {
    const Cookie = getRequestHeader("Cookie") ?? "";

    return createClient({
      Cookie,
      baseURL: env.VITE_API_URL,
    });
  })
  .client(() =>
    createClient({
      baseURL: env.VITE_API_URL,
    })
  );

export type BetterAuthClient = ReturnType<typeof createAuthClient>;

export type Role = BetterAuthClient["$Infer"]["Member"]["role"];
export type PermissionStatements = typeof statement;

export const AUTH_COOKIES = [
  `${COOKIE_PREFIX}.session_token`,
  `__Secure-${COOKIE_PREFIX}.session_token`,
];
