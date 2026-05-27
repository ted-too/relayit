import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { AUTH_COOKIES } from "@/integrations/better-auth";
import { queries } from "@/integrations/queries";

const clearAuthCookies = createServerFn({ method: "POST" }).handler(() => {
  for (const cookie of AUTH_COOKIES) {
    setCookie(cookie, "", { maxAge: 0 });
  }
});

export const Route = createFileRoute("/_authd")({
  beforeLoad: async ({ context }) => {
    if (!context.isPotentialAuthd) {
      throw redirect({ to: "/auth/sign-in" });
    }

    try {
      await context.queryClient.ensureQueryData(queries.session.me);
    } catch (error) {
      clearAuthCookies();
      if (context.env.VITE_DEBUG) {
        console.error(error);
      }
      throw redirect({ to: "/auth/sign-in" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="bg-[hsl(0,0%,98%)]">
      <Outlet />
    </div>
  );
}
