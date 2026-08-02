import { sharedCookieDomain } from "@repo/api/server/lib/auth/cookie-domain";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { env } from "@/env";
import { AUTH_COOKIES } from "@/integrations/better-auth";
import { queries } from "@/integrations/queries";

const clearAuthCookies = createServerFn({ method: "POST" }).handler(() => {
  const domain = sharedCookieDomain(env.VITE_BASE_URL, env.VITE_API_URL);

  for (const cookie of AUTH_COOKIES) {
    // `__Secure-` / `__Host-` names require the Secure attribute or Bun throws.
    // `__Host-` forbids Domain; we only emit `__Secure-` variants.
    const requiresSecure =
      cookie.startsWith("__Secure-") || cookie.startsWith("__Host-");
    const base = {
      maxAge: 0,
      path: "/",
      ...(requiresSecure ? { secure: true } : {}),
    } as const;

    // Host-only (legacy / same-origin) and parent-domain (cross-subdomain).
    setCookie(cookie, "", base);
    if (domain) {
      setCookie(cookie, "", { ...base, domain });
    }
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
