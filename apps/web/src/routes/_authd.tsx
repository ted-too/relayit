import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppSidebar } from "@/components/layout/app-sidebar";

// const clearAuthCookies = createServerFn({ method: "POST" }).handler(() => {
//   for (const cookie of AUTH_COOKIES) {
//     setCookie(cookie, "", { maxAge: 0 });
//   }
// });

export const Route = createFileRoute("/_authd")({
  // beforeLoad: async ({ context }) => {
  //   if (!context.isPotentialAuthd) {
  //     throw redirect({ to: "/auth/sign-in" });
  //   }

  //   try {
  //     await context.queryClient.ensureQueryData(queries.auth.session.me);
  //   } catch (error) {
  //     // clearAuthCookies();
  //     if (import.meta.env.DEV) {
  //       console.error(error);
  //     }
  //     throw redirect({ to: "/auth/sign-in" });
  //   }
  // },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <AppSidebar>
      <main className="grow">
        <Outlet />
      </main>
    </AppSidebar>
  );
}
