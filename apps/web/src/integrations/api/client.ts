import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/api/server";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { env } from "@/env";

type TreatyConfig = Parameters<typeof treaty>[1];

export const createClient = createIsomorphicFn()
  .server((opts?: TreatyConfig) => {
    const Cookie = getRequestHeader("Cookie");

    return treaty<App>(env.VITE_API_URL, {
      ...opts,
      fetch: {
        credentials: "omit",
      },
      headers: {
        Cookie,
      },
    });
  })
  .client((opts?: TreatyConfig) =>
    treaty<App>(env.VITE_API_URL, {
      ...opts,
      fetch: {
        credentials: "include",
      },
    })
  );

export type ApiClient = ReturnType<typeof createClient>;
