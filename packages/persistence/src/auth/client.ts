import { apiKeyClient } from "@better-auth/api-key/client";
import { stripeClient } from "@better-auth/stripe/client";
import { adminClient, lastLoginMethodClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import {
  ac as organizationAc,
  admin as organizationAdminRole,
  member as organizationMemberRole,
  owner as organizationOwnerRole,
} from "./permissions";

/** better-auth's client, on the page's own origin (`/api/auth`). */
export const createAuthClient = () =>
  createBetterAuthClient({
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
