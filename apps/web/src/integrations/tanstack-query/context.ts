import { QueryClient } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import superjson from "superjson";
import { createTrpcClient } from "@/integrations/trpc/client";

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      dehydrate: { serializeData: superjson.serialize },
      hydrate: { deserializeData: superjson.deserialize },
    },
  });

  const trpc = createTRPCOptionsProxy({
    client: createTrpcClient(),
    queryClient,
  });

  return {
    queryClient,
    trpc,
  };
}
