import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getContext } from "@/integrations/context";
import { Provider as TanstackQueryProvider } from "@/integrations/tanstack-query/root-provider";
import { DefaultCatchBoundary } from "./components/default-catch";
import { NotFound } from "./components/not-found";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  const context = getContext();

  const router = createTanStackRouter({
    routeTree,
    context,
    defaultPreload: "intent",
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    Wrap: (props: { children: React.ReactNode }) => {
      return (
        <TanstackQueryProvider queryClient={context.queryClient}>
          {props.children}
        </TanstackQueryProvider>
      );
    },
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient: context.queryClient,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
