import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/api";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

type TreatyConfig = Parameters<typeof treaty>[1];

export const createClient = createIsomorphicFn()
  .server((opts?: TreatyConfig) => {
    const Cookie = getRequestHeader("Cookie") ?? "";

    return treaty<App>(process.env.VITE_API_URL ?? "http://localhost:3005", {
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
    treaty<App>(import.meta.env.VITE_API_URL ?? "http://localhost:3005", {
      ...opts,
      fetch: {
        credentials: "include",
      },
    })
  );

export type API = ReturnType<typeof createClient>;
