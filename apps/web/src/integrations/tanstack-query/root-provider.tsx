import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createTrpcClient } from "@/integrations/trpc/client";
import { TRPCProvider } from "@/integrations/trpc/react";

export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  const [trpcClient] = useState(() => createTrpcClient());

  return (
    <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
      {children}
    </TRPCProvider>
  );
}
