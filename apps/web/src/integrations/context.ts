import { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import {
  createTRPCOptionsProxy,
  type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import superjson from "superjson";
import type { AuthClient } from "@/integrations/better-auth/client";
import { createAuthClient } from "@/integrations/better-auth/client";
import { createTrpcClient } from "@/integrations/trpc/client";
import type { TRPCRouter } from "@/integrations/trpc/router";

const createTrpc = createIsomorphicFn()
  .server(() => {
    const req = getWebRequest();

    const cookie = req.headers.get("cookie");
    return createTrpcClient(cookie);
  })
  .client(() => {
    return createTrpcClient();
  });

const createAuth = createIsomorphicFn()
  .server(() => {
    const req = getWebRequest();
    const cookie = req.headers.get("cookie");
    return createAuthClient(cookie);
  })
  .client(() => {
    return createAuthClient();
  });

export interface RouterContext {
  queryClient: QueryClient;
  trpc: TRPCOptionsProxy<TRPCRouter>;
  auth: AuthClient;
}

export function getContext(): RouterContext {
  const queryClient = new QueryClient({
    defaultOptions: {
      dehydrate: { serializeData: superjson.serialize },
      hydrate: { deserializeData: superjson.deserialize },
    },
  });

  return {
    queryClient,
    trpc: createTRPCOptionsProxy({
      client: createTrpc(),
      queryClient,
    }),
    auth: createAuth(),
  };
}
