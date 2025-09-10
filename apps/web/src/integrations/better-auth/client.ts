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
      organizationClient(),
      lastLoginMethodClient(),
      reactStartCookies(),
    ],
    fetchOptions: {
      credentials: "include",
      headers: cookie ? { cookie } : undefined,
    },
  });

export type AuthClient = ReturnType<typeof createAuthClient>;

// export type Session = typeof authClient.$Infer.Session;
// export type User = Session["user"];
// export type Organization = typeof authClient.$Infer.Organization;

// export type OrganizationMember = {
//   id: string;
//   organizationId: string;
//   role: string;
//   createdAt: Date;
//   userId: string;
//   user: {
//     email: string;
//     name: string;
//     image: string | null | undefined;
//   };
// };

// export type BaseApiKey = {
//   metadata: any;
//   permissions: any;
//   id: string;
//   name: string | null;
//   start: string | null;
//   prefix: string | null;
//   userId: string;
//   refillInterval: number | null;
//   refillAmount: number | null;
//   // TODO: More fields...
//   createdAt: Date;
//   updatedAt: Date;
// };

// export interface CreatedApiKey extends BaseApiKey {
//   key: string;
// }
