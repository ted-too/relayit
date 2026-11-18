import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.fetchQuery(queries.session.me).catch(() => null);

    if (!session) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.pathname },
      });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="min-h-svh bg-[hsl(0,0%,98%)]">
      <Outlet />
    </div>
  );
}
