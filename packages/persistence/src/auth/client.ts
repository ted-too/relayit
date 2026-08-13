import { apiKeyClient } from "@better-auth/api-key/client";
import { stripeClient } from "@better-auth/stripe/client";
import {
  adminClient,
  lastLoginMethodClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import {
  ac as organizationAc,
  admin as organizationAdminRole,
  member as organizationMemberRole,
  owner as organizationOwnerRole,
} from "./permissions";

interface AuthClientConfig {
  baseURL: string;
}

export const createAuthClient = ({ baseURL }: AuthClientConfig) =>
  createBetterAuthClient({
    baseURL,
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
      tanstackStartCookies(),
    ],
  });
