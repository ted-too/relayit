import {
  SidebarInset,
  SidebarProvider,
} from "@repo/ui/components/ui/shad/sidebar";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { queries } from "@/integrations/queries";

export const Route = createFileRoute("/_authd/$orgSlug")({
  beforeLoad: async ({ context, params }) => {
    const userOrganizations = await context.queryClient.ensureQueryData(
      queries.session.me.organizations.list
    );

    const currentOrganization = userOrganizations.find(
      (organization) => organization.slug === params.orgSlug
    );

    if (!currentOrganization) {
      throw redirect({ to: "/" });
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      queries.session.me.organizations.bySlug(params.orgSlug)
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { sidebarOpen, isMobile } = Route.useRouteContext();
  return (
    <div className="flex size-full">
      <SidebarProvider defaultOpen={sidebarOpen} isMobile={isMobile}>
        <AppSidebar />
        <SidebarInset className="grow bg-[hsl(0,0%,98%)]">
          <AppHeader />
          <div className="mx-auto mt-6 w-[calc(1200px+3rem)] max-w-full px-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
