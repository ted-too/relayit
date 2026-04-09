import { apiKeyClient } from "@better-auth/api-key/client";
import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/api";
import { ac, admin, member, owner } from "@repo/shared/permissions";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import {
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "./index";

const createAuthClient = (
  baseURL: string,
  { cookie }: { cookie?: string | null } = {}
) =>
  createBetterAuthClient({
    baseURL,
    basePath: "/auth",
    plugins: [
      apiKeyClient(),
      organizationClient({
        ac,
        roles: {
          owner,
          admin,
          member,
        },
      }),
      lastLoginMethodClient(),
    ],
    fetchOptions: cookie
      ? {
          headers: { cookie },
        }
      : undefined,
  });

export const createClient = createIsomorphicFn()
  .server((opts?: TreatyConfig) => {
    const Cookie = getRequestHeader("Cookie") ?? "";

    return treaty<App>(process.env.VITE_API_URL ?? "http://localhost:3005", {
      ...opts,
      fetch: {
        credentials: "omit",
      },
      headers: {
        Cookie,
      },
    });
  })
  .client((opts?: TreatyConfig) =>
    treaty<App>(import.meta.env.VITE_API_URL ?? "http://localhost:3005", {
      ...opts,
      fetch: {
        credentials: "include",
      },
    })
  );

export type BetterAuthClient = ReturnType<typeof createClient>;
