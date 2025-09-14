import { ac, admin, member, owner } from "@repo/shared/permissions";
import {
  apiKeyClient,
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { reactStartCookies } from "better-auth/react-start";
import { getUrl } from "@/integrations/trpc/client";

export const createAuthClient = (cookie?: string | null) =>
  createBetterAuthClient({
    baseURL: getUrl(),
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
      reactStartCookies(),
    ],
    fetchOptions: cookie
      ? {
          headers: { cookie },
        }
      : undefined,
  });

export type AuthClient = ReturnType<typeof createAuthClient>;

export const AUTH_COOKIES = ["relayit.session_token"];