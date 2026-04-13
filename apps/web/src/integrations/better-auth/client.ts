import { apiKeyClient } from "@better-auth/api-key/client";
import { BASE_PATH } from "@repo/api/server/lib/auth/constants";
import {
  ac,
  admin,
  member,
  owner,
} from "@repo/api/server/lib/auth/permissions";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import {
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { env } from "@/env";

const createAuthClient = ({
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

export const createClient = createIsomorphicFn()
  .server(() => {
    const Cookie = getRequestHeader("Cookie") ?? "";

    return createAuthClient({
      Cookie,
      baseURL: env.VITE_API_URL,
    });
  })
  .client(() =>
    createAuthClient({
      baseURL: env.VITE_API_URL,
    })
  );

export type BetterAuthClient = ReturnType<typeof createClient>;
