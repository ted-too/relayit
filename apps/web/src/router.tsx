import { PageLoader } from "@repo/ui/components/ui/custom/page-loader";
import { createRouter } from "@tanstack/react-router";
import { DefaultCatchBoundary } from "@/components/default-catch";
import { NotFound } from "@/components/not-found";
import { getContext } from "@/lib/router-context";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const context = getContext();

  return createRouter({
    routeTree,
    context,
    defaultPreload: "intent",
    defaultPendingComponent: PageLoader,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: DefaultCatchBoundary,
    scrollRestoration: true,
  });
};
