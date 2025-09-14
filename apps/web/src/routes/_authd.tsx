import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { AUTH_COOKIES } from "@/integrations/better-auth/client";

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
      const data = await context.queryClient.ensureQueryData(
        context.trpc.auth.getSession.queryOptions()
      );

      return data;
    } catch (error) {
      clearAuthCookies();
      if (import.meta.env.DEV) console.error(error);
      throw redirect({ to: "/auth/sign-in" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
