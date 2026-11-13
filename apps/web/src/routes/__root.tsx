import { Toaster } from "@repo/ui/components/ui/shad/sonner";
import { SIDEBAR_COOKIE_NAME } from "@repo/ui/constants";
import { TanStackQueryDevtools } from "@repo/ui/integrations/tanstack-query/devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
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
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <Outlet />
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
    </>
  );
}
