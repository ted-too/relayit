import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/api/server";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { env } from "@/env";

type TreatyConfig = Parameters<typeof treaty>[1];

export const createApiClient = createIsomorphicFn()
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

export type ApiClient = ReturnType<typeof createApiClient>;

// biome-ignore lint/suspicious/noExplicitAny: type utility needs to accept any function shape
type ResolveTreatyResponse<T> = T extends (...args: any[]) => any
  ? Awaited<ReturnType<T>>
  : Awaited<T>;

export type InferData<T> = NonNullable<
  ResolveTreatyResponse<T> extends {
    data: infer D;
  }
    ? D
    : never
>;

export type InferError<T> = NonNullable<
  ResolveTreatyResponse<T> extends {
    error: infer E;
  }
    ? E
    : never
>;

interface EdenErrorLike {
  status: number;
  value: unknown;
}

export function formatToastError(
  error: EdenErrorLike
): [title: string, options?: { description: string }] {
  if (!error) {
    return ["Something went wrong"];
  }

  const { status, value } = error;

  let title: string;
  if (status === 422) {
    title = "Validation Error";
  } else if (typeof value === "string") {
    title = value;
  } else {
    title = "Something went wrong";
  }

  if (value && typeof value === "object") {
    const { summary, message } = value as {
      summary?: string;
      message?: string;
    };
    const description = summary ?? message;
    if (description) {
      return [title, { description }];
    }
  }

  return [title];
}
