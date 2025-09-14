import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppSidebar } from "@/components/layout/app-sidebar";

export const Route = createFileRoute("/_authd/$projectSlug")({
  beforeLoad: async ({ context, params }) => {
    const currentOrganization = context.userOrganizations.find(
      (organization) => organization.slug === params.projectSlug
    );

    if (!currentOrganization) {
      throw redirect({ to: "/" });
    }

    if (currentOrganization.id !== context.session.activeOrganization?.id) {
      await context.auth.organization.setActive({
        organizationId: currentOrganization.id,
        organizationSlug: currentOrganization.slug,
      });
      await context.queryClient.invalidateQueries(
        context.trpc.auth.getSession.queryOptions()
      );
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex size-full">
      <AppSidebar />
      <main className="grow bg-[hsl(0,0%,98%)] p-4">
        <Outlet />
      </main>
    </div>
  );
}
