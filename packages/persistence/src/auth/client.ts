import { apiKeyClient } from "@better-auth/api-key/client";
import { stripeClient } from "@better-auth/stripe/client";
import { adminClient, lastLoginMethodClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { AUTH_BASE_PATH } from "./constants";
import {
  ac as organizationAc,
  admin as organizationAdminRole,
  member as organizationMemberRole,
  owner as organizationOwnerRole,
} from "./permissions";

/**
 * better-auth's client, for the api at `apiOrigin`. The dashboard is on another origin of
 * the same site, so every call sends the session cookie (`credentials: "include"`, which
 * the client sets by default).
 */
export const createAuthClient = (apiOrigin: string) =>
  createBetterAuthClient({
    baseURL: `${apiOrigin}${AUTH_BASE_PATH}`,
    plugins: [
      adminClient(),
      stripeClient({
        subscription: true,
      }),
      organizationClient({
        ac: organizationAc,
        roles: {
          owner: organizationOwnerRole,
          admin: organizationAdminRole,
          member: organizationMemberRole,
        },
      }),
      lastLoginMethodClient(),
      apiKeyClient(),
    ],
  });
