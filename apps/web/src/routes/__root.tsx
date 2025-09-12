import { Toaster } from "@repo/ui/components/custom/sonner";
import {
  type Theme,
  ThemeProvider,
  useTheme,
} from "@repo/ui/components/custom/theme-provider";
import { SIDEBAR_COOKIE_NAME, THEME_COOKIE_NAME } from "@repo/ui/constants";
import appCss from "@repo/ui/globals.css?url";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import z from "zod";
import { AUTH_COOKIES } from "@/integrations/better-auth/client";
import type { RouterContext } from "@/integrations/context";

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
  beforeLoad: async () => {
    const [{ isMobile }, sidebarOpen = "false", theme, ...sessionCookies] =
      await Promise.all([
        getSSRMobileDetection(),
        getSSRCookie({ data: { name: SIDEBAR_COOKIE_NAME } }),
        getSSRCookie({ data: { name: THEME_COOKIE_NAME } }),
        ...AUTH_COOKIES.map((cookie) =>
          getSSRCookie({ data: { name: cookie } })
        ),
      ]);

    return {
      isMobile,
      isPotentialAuthd: sessionCookies.filter(Boolean).length > 0,
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
        <Toaster richColors />
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
