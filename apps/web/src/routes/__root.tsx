import { Toaster } from "@repo/ui/components/ui/shad/sonner";
import { SIDEBAR_COOKIE_NAME } from "@repo/ui/constants";
import { TanStackQueryDevtools } from "@repo/ui/integrations/tanstack-query/devtools";
import appCss from "@repo/ui/styles/globals.css?url";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { queries } from "@/lib/queries";

const MOBILE_REGEX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;
const SCREEN_SIZE_REGEX = /Mobile.*Safari|Android.*Mobile/i;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context }) => {
    const config = await context.queryClient.ensureQueryData(queries.config.get);
    const userAgent = navigator.userAgent;
    return {
      isBillingEnabled: config.billing,
      isGitHubAuthEnabled: config.githubSignIn,
      isMobile: MOBILE_REGEX.test(userAgent) || SCREEN_SIZE_REGEX.test(userAgent),
      sidebarOpen: document.cookie
        .split("; ")
        .some((cookie) => cookie === `${SIDEBAR_COOKIE_NAME}=true`),
    };
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1",
      },
      {
        name: "robots",
        content: "noindex, nofollow",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "RelayIt",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon-96x96.png",
        sizes: "96x96",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "shortcut icon",
        href: "/favicon.ico",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/site.webmanifest",
      },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {import.meta.env.VITE_DEBUG === "true" && (
          <script crossOrigin="anonymous" src="//unpkg.com/react-scan/dist/auto.global.js" />
        )}
        <HeadContent />
      </head>
      <body className="relative">
        <div className="relative isolate flex min-h-svh flex-col">{children}</div>
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
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
