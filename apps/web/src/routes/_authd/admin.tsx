import {
  SidebarInset,
  SidebarProvider,
} from "@repo/ui/components/ui/shad/sidebar";
import {
  createFileRoute,
  notFound,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { Category2, Cloud, FolderOpen, Profile2User } from "iconsax-reactjs";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar, type NavItemGroup } from "@/components/layout/app-sidebar";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd/admin")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      queries.session.me
    );

    if (session.user.role !== "admin") {
      throw notFound();
    }
  },
  component: RouteComponent,
});

const NAV_ITEMS = [
  {
    items: [
      {
        title: "Overview",
        to: "/admin",
        icon: Category2,
      },
      {
        title: "Projects",
        to: "/admin/projects",
        icon: FolderOpen,
      },
      {
        title: "Users",
        to: "/admin/users",
        icon: Profile2User,
      },
    ],
  },
  {
    headerTitle: "Settings",
    items: [
      {
        title: "Integrations",
        to: "/admin/settings/integrations",
        icon: Cloud,
      },
    ],
  },
] as const satisfies NavItemGroup[];

function RouteComponent() {
  const { sidebarOpen, isMobile } = Route.useRouteContext();
  const pathname = useLocation({
    select: (location) => location.pathname,
  });

  return (
    <div className="flex size-full">
      <SidebarProvider defaultOpen={sidebarOpen} isMobile={isMobile}>
        <AppSidebar items={NAV_ITEMS} pathname={pathname} />
        <SidebarInset className="grow bg-[hsl(0,0%,98%)]">
          <AppHeader items={NAV_ITEMS} pathname={pathname} />
          <div className="mx-auto mt-6 w-[calc(1200px+3rem)] max-w-full px-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
