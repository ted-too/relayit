import { makeQueryClient } from "@repo/ui/integrations/tanstack-query/client";
import type { QueryClient } from "@tanstack/react-query";
import { type API, createClient as createAPIClient } from "./api";

export interface RouterContext {
  api: API;
  queryClient: QueryClient;
}

export const getContext = () =>
  ({
    queryClient: makeQueryClient(),
    api: createAPIClient(),
  }) satisfies RouterContext;
