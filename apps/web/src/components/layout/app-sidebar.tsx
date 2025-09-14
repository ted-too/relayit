import {
  type RemixiconComponentType,
  RiContactsLine,
  RiDashboardLine,
  RiLineChartLine,
  RiPencilRuler2Line,
  RiSettings2Line,
} from "@remixicon/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@repo/ui/components/animate-ui/components/radix/sidebar";
import type { IconProps } from "@repo/ui/components/animate-ui/icons/icon";
import {
  Link,
  useLocation,
  useParams,
  useRouteContext,
} from "@tanstack/react-router";
import { ProjectSwitcher } from "./project-switcher";
import { SideBarUserNav } from "./user-nav";

type NavItem = {
  title: string;
  url: string;
  // TODO: Make animated icons work
  icon: RemixiconComponentType | React.ComponentType<IconProps>;
  comingSoon?: boolean;
};

const NAV_ITEMS: { headerTitle?: string; items: NavItem[] }[] = [
  {
    items: [
      {
        title: "Dashboard",
        url: "/",
        icon: RiDashboardLine,
      },
      {
        title: "Contacts",
        url: "/contacts",
        icon: RiContactsLine,
      },
      {
        title: "Analytics",
        url: "/analytics",
        icon: RiLineChartLine,
        comingSoon: true,
      },
      {
        title: "Project Settings",
        url: "/settings",
        icon: RiSettings2Line,
      },
    ],
  },
  {
    headerTitle: "Automations",
    items: [
      {
        title: "Templates",
        url: "/templates",
        icon: RiPencilRuler2Line,
      },
    ],
  },
];

/**
 * Checks if a route is active based on current pathname
 * TODO: Fix sub menu items
 */
function isActiveRoute(itemUrl: string, pathname: string): boolean {
  if (!pathname) {
    return false;
  }

  if (itemUrl === "/") {
    return pathname === itemUrl;
  }

  if (pathname.startsWith(itemUrl)) {
    return true;
  }

  return false;
}

export function AppSidebar() {
  const { sidebarOpen, isMobile } = useRouteContext({
    from: "/_authd/$projectSlug",
  });
  const { projectSlug } = useParams({
    from: "/_authd/$projectSlug",
  });
  const pathname = useLocation({
    select: (location) => {
      const cleanPathname = location.pathname.replace(`/${projectSlug}`, "");

      return cleanPathname.startsWith("/")
        ? cleanPathname
        : `/${cleanPathname}`;
    },
  });

  return (
    <SidebarProvider
      defaultOpen={sidebarOpen}
      isMobile={isMobile}
      className="shadow-[inset_-1px_0px_rgba(0,0,0,0.06)]"
    >
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="mb-2 h-16 justify-center max-md:mt-2">
          <ProjectSwitcher />
        </SidebarHeader>
        <SidebarContent>
          {NAV_ITEMS.map((item, idx) => (
            <SidebarGroup key={`${item.headerTitle}-${idx}`}>
              {item.headerTitle && (
                <SidebarGroupLabel className="text-muted-foreground/60">
                  {item.headerTitle}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="gap-2">
                  {item.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        className="group/menu-button h-9 gap-3 rounded-md bg-gradient-to-r hover:bg-transparent hover:from-sidebar-accent hover:to-sidebar-accent/40 data-[active=true]:from-primary/20 data-[active=true]:to-primary/5 data-[active=true]:font-medium group-data-[collapsible=icon]:px-[5px]! [&>svg]:size-auto"
                        tooltip={item.title}
                        isActive={isActiveRoute(item.url, pathname)}
                        isAvailable={!item.comingSoon}
                      >
                        <Link to={`/${projectSlug}${item.url}` as any}>
                          {item.icon && (
                            <item.icon
                              className="text-muted-foreground/60 group-data-[active=true]/menu-button:text-primary"
                              size={22}
                              aria-hidden="true"
                            />
                          )}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SideBarUserNav />
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}
