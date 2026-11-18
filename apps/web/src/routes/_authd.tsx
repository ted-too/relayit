import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { fetchSessionOrNull } from "@/lib/queries/session";

export const Route = createFileRoute("/_authd")({
  beforeLoad: async ({ context, location }) => {
    const session = await fetchSessionOrNull(context.queryClient);

    if (!session) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.href },
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
