import { getQueryClient } from "@repo/ui/integrations/tanstack-query/client";
import type { QueryClient } from "@tanstack/react-query";

export interface RouterContext {
  queryClient: QueryClient;
}

export const getContext = (): RouterContext => ({
  queryClient: getQueryClient(),
});
