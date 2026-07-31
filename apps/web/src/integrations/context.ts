import { getQueryClient } from "@repo/ui/integrations/tanstack-query/client";
import type { QueryClient } from "@tanstack/react-query";
import { type Env, env } from "@/env";
import { type ApiClient, createApiClient } from "./api";
import { type BetterAuthClient, createAuthClient } from "./better-auth";

export interface RouterContext {
  api: ApiClient;
  betterAuth: BetterAuthClient;
  env: Env;
  queryClient: QueryClient;
  /** From SSR — server `EDITION=cloud`. */
  isCloudEdition: boolean;
  isMobile: boolean;
  isPotentialAuthd: boolean;
  sidebarOpen: boolean;
}

export const getContext = (): RouterContext =>
  ({
    env,
    api: createApiClient(),
    betterAuth: createAuthClient(),
    queryClient: getQueryClient(),
    isCloudEdition: false,
    isMobile: false,
    isPotentialAuthd: false,
    sidebarOpen: false,
  }) satisfies RouterContext;
