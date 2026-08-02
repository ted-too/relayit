import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { AUTH_COOKIES } from "@/integrations/better-auth";
import { queries } from "@/integrations/queries";

const clearAuthCookies = createServerFn({ method: "POST" }).handler(() => {
  for (const cookie of AUTH_COOKIES) {
    // `__Secure-` / `__Host-` names require the Secure attribute or Bun throws.
    const requiresSecure =
      cookie.startsWith("__Secure-") || cookie.startsWith("__Host-");
    setCookie(cookie, "", {
      maxAge: 0,
      path: "/",
      ...(requiresSecure ? { secure: true } : {}),
    });
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
      await clearAuthCookies();
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
    <div className="min-h-svh bg-[hsl(0,0%,98%)]">
      <Outlet />
    </div>
  );
}
