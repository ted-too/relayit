import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import superjson from "superjson";
import type { TRPCRouter } from "@/integrations/trpc/router";

export function getUrl() {
  const DEFAULT_URL = "http://localhost:3009";
  if (typeof window !== "undefined")
    return import.meta.env.VITE_API_URL ?? DEFAULT_URL;
  return process.env.VITE_API_URL ?? DEFAULT_URL;
}

export const createTrpcClient = (cookie?: string | null) =>
  createTRPCClient<TRPCRouter>({
    links: [
      httpBatchStreamLink({
        transformer: superjson,
        url: `${getUrl()}/trpc`,
        headers: cookie ? { cookie } : undefined,
        fetch: (url, options) => {
          return fetch(url, {
            ...options,
            credentials: "include",
          });
        },
      }),
    ],
  });
