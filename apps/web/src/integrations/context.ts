import { getQueryClient } from "@repo/ui/integrations/tanstack-query/client";
import type { QueryClient } from "@tanstack/react-query";
import { type ApiClient, createClient as createAPIClient } from "./api";
import {
  type BetterAuthClient,
  createClient as createBetterAuthClient,
} from "./better-auth";

export interface RouterContext {
  api: ApiClient;
  betterAuth: BetterAuthClient;
  queryClient: QueryClient;
}

export const getContext = () =>
  ({
    api: createAPIClient(),
    betterAuth: createBetterAuthClient(),
    queryClient: getQueryClient(),
  }) satisfies RouterContext;
