import {
  type Theme,
  ThemeProvider,
  useTheme,
} from "@repo/ui/components/custom/theme-provider";
import { SIDEBAR_COOKIE_NAME, THEME_COOKIE_NAME } from "@repo/ui/constants";
import appCss from "@repo/ui/globals.css?url";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getWebRequest } from "@tanstack/react-start/server";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import z from "zod";
import type { AuthClient } from "@/integrations/better-auth/client";
import type { TRPCRouter } from "@/integrations/trpc/router";

interface RouterContext {
  queryClient: QueryClient;
  trpc: TRPCOptionsProxy<TRPCRouter>;
  auth: AuthClient;
}

export const getSSRCookie = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string(),
    })
  )
  .handler(({ data }) => {
    const value = getCookie(data.name);

    return value;
  });

export const getCookieString = createServerFn({ method: "GET" }).handler(() => {
  const req = getWebRequest();

  return req.headers.get("cookie");
});

const MOBILE_REGEX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
const SCREEN_SIZE_REGEX = /Mobile.*Safari|Android.*Mobile/i;

export const getSSRMobileDetection = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getWebRequest } = await import("@tanstack/react-start/server");
    const request = getWebRequest();
    const userAgent = request.headers.get("user-agent") || "";

    const isMobile = MOBILE_REGEX.test(userAgent);
    const hasScreenSizeHints = SCREEN_SIZE_REGEX.test(userAgent);

    return {
      isMobile: isMobile || hasScreenSizeHints,
      userAgent,
    };
  }
);

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "TanStack Start Starter",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  beforeLoad: async ({ context }) => {
    const cookieString = await getCookieString();
    const [{ data, error }, { isMobile }, sidebarOpen = "false", theme] =
      await Promise.all([
        context.auth.getSession({
          fetchOptions: {
            credentials: "include",
            headers: { cookie: cookieString ?? "" },
          },
        }),
        getSSRMobileDetection(),
        getSSRCookie({ data: { name: SIDEBAR_COOKIE_NAME } }),
        getSSRCookie({ data: { name: THEME_COOKIE_NAME } }),
      ]);

    if (import.meta.env.DEV && error) {
      console.error("Error getting session", error);
    }

    if (data?.session && data?.user) {
      return {
        session: data.session,
        user: data.user,
        isMobile,
        sidebarOpen: sidebarOpen === "true",
        theme,
      };
    }

    return {
      session: null,
      user: null,
      isMobile,
      sidebarOpen: sidebarOpen === "true",
      theme,
    };
  },
  component: RootComponent,
});

function RootComponent() {
  const data = Route.useRouteContext();
  const theme = data?.theme as Theme | undefined;

  return (
    <ThemeProvider defaultTheme={theme}>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </ThemeProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <html className={theme} lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        <div className="Root">{children}</div>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            {
              name: "React Query",
              render: <ReactQueryDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
