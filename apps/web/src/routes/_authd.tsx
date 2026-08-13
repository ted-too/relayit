import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth.functions";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd")({
  beforeLoad: async ({ context, location }) => {
    const session = await getSession();

    if (!session) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.pathname },
      });
    }

    await context.queryClient.setQueryData(
      queries.session.me.queryKey,
      session
    );
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
