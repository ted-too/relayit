import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { getAuthContext } from "@/integrations/better-auth/context";
import { getContext } from "@/integrations/tanstack-query/context";
import { Provider as TanstackQueryProvider } from "@/integrations/tanstack-query/root-provider";
import { DefaultCatchBoundary } from "./components/default-catch";
import { NotFound } from "./components/not-found";
import { routeTree } from "./routeTree.gen";

export function createRouter() {
	const rqContext = getContext();
	const authContext = getAuthContext();

	const router = createTanStackRouter({
		routeTree,
		context: { ...rqContext, ...authContext },
		defaultPreload: "intent",
		defaultErrorComponent: DefaultCatchBoundary,
		defaultNotFoundComponent: () => <NotFound />,
		Wrap: (props: { children: React.ReactNode }) => {
			return (
				<TanstackQueryProvider queryClient={rqContext.queryClient}>
					{props.children}
				</TanstackQueryProvider>
			);
		},
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient: rqContext.queryClient,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createRouter>;
	}
}
