import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "@/components/layout/app-sidebar";

export const Route = createFileRoute("/_authd")({
	beforeLoad: ({ context }) => {
		if (context.session === null || context.user === null) {
			throw redirect({ to: "/auth/sign-in" });
		}

		return {
			session: context.session,
			user: context.user,
		};
	},
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<AppSidebar>
			<Outlet />
		</AppSidebar>
	);
}
