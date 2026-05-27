import { Badge } from "@repo/ui/components/reui/badge";
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
  SidebarRail,
} from "@repo/ui/components/ui/shad/sidebar";
import { useSuspenseQueries } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useParams,
  useRouteContext,
} from "@tanstack/react-router";
import {
  BrushSquare,
  Category2,
  Cloud,
  GlobalEdit,
  Hierarchy,
  type Icon,
  Key,
  Personalcard,
} from "iconsax-reactjs";
import type { PermissionStatements } from "@/integrations/better-auth";
import { queries } from "@/integrations/queries";
import { NavProject } from "./nav-projects";
import { SidebarNavUser } from "./nav-user";

type RequiredPermissions = {
  [K in keyof PermissionStatements]?: PermissionStatements[K][number][];
};

interface NavItem {
  comingSoon?: boolean;
  icon: Icon;
  match?: string[];
  requiredPermissions?: RequiredPermissions | RequiredPermissions[];
  title: string;
  to: string;
}

interface NavItemGroup {
  headerTitle?: string;
  items: NavItem[];
}

const NAV_ITEMS = [
  {
    items: [
      {
        title: "Overview",
        to: "/$orgSlug",
        icon: Category2,
        requiredPermissions: {
          message: ["read"],
        },
      },
      {
        title: "Contacts",
        to: "/$orgSlug/contacts",
        icon: Personalcard,
        comingSoon: true,
        requiredPermissions: {
          contact: ["read"],
        },
      },
    ],
  },
  {
    headerTitle: "Automations",
    items: [
      {
        title: "Templates",
        to: "/$orgSlug/automations/templates",
        icon: BrushSquare,
        requiredPermissions: {
          template: ["read"],
        },
      },
      {
        title: "Workflows",
        to: "/$orgSlug/automations/workflows",
        icon: Hierarchy,
        comingSoon: true,
        requiredPermissions: {
          workflow: ["read"],
        },
      },
    ],
  },
  {
    headerTitle: "Settings",
    items: [
      {
        title: "Project details",
        to: "/$orgSlug/settings/project",
        icon: GlobalEdit,
        requiredPermissions: {
          organization: ["update"],
        },
      },
      {
        title: "API keys",
        to: "/$orgSlug/settings/api-keys",
        icon: Key,
        requiredPermissions: {
          apiKey: ["read"],
        },
      },
      {
        title: "Integrations",
        to: "/$orgSlug/settings/integrations",
        icon: Cloud,
        requiredPermissions: {
          integration: ["read"],
        },
      },
    ],
  },
] as const satisfies NavItemGroup[];

const navItemToPath = (to: string): string =>
  to.replace("/$orgSlug/", "/").replace("/$orgSlug", "/");

function isActiveRoute(
  itemUrl: string,
  pathname: string,
  match = [] as string[]
): boolean {
  if (!pathname) {
    return false;
  }

  if (match.some((m) => pathname.startsWith(m))) {
    return true;
  }

  if (itemUrl === "/") {
    return pathname === itemUrl;
  }

  if (pathname.startsWith(itemUrl)) {
    return true;
  }

  return false;
}

function findActiveNavItem(pathname: string) {
  let best: { group: NavItemGroup; item: NavItem; path: string } | null = null;

  for (const group of NAV_ITEMS) {
    for (const item of group.items) {
      const itemPath = navItemToPath(item.to);
      const match = "match" in item ? (item.match as string[]) : undefined;

      if (!isActiveRoute(itemPath, pathname, match)) {
        continue;
      }

      if (!best || itemPath.length > best.path.length) {
        best = { group, item, path: itemPath };
      }
    }
  }

  return best;
}

export function getBreadcrumbSegments(pathname: string) {
  const active = findActiveNavItem(pathname);
  if (!active) {
    return [];
  }

  const segments: { title: string; to?: string }[] = [];

  if ("headerTitle" in active.group && active.group.headerTitle) {
    segments.push({ title: active.group.headerTitle });
  }

  segments.push({ title: active.item.title, to: active.item.to });

  return segments;
}

export function AppSidebar() {
  const { betterAuth } = useRouteContext({
    from: "/_authd",
  });
  const { orgSlug } = useParams({
    from: "/_authd/$orgSlug",
  });
  const pathname = useLocation({
    select: (location) => {
      const prefix = `/${orgSlug}`;
      return location.pathname.startsWith(prefix)
        ? location.pathname.slice(prefix.length) || "/"
        : location.pathname;
    },
  });
  const [{ data: me }, { data: organization }] = useSuspenseQueries({
    queries: [
      queries.session.me,
      queries.session.me.organizations.bySlug(orgSlug),
    ],
  });

  const member = organization?.members.find(
    (member) => member.userId === me.user.id
  );

  if (!member) {
    return null;
  }

  const canShowNavItem = (item: NavItem) => {
    if (!item.requiredPermissions) {
      return true;
    }

    const check = (permissions: RequiredPermissions) =>
      betterAuth.organization.checkRolePermission({
        permissions,
        role: member.role,
      });

    return Array.isArray(item.requiredPermissions)
      ? item.requiredPermissions.some(check)
      : check(item.requiredPermissions);
  };

  const FILTERED_NAV_ITEMS = NAV_ITEMS.map((group) => ({
    ...group,
    items: group.items.filter(canShowNavItem),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <NavProject />
      </SidebarHeader>
      <SidebarContent>
        {FILTERED_NAV_ITEMS.map((item, idx) => (
          <SidebarGroup
            key={`${"headerTitle" in item ? item.headerTitle : "default"}-${idx}`}
          >
            {"headerTitle" in item && (
              <SidebarGroupLabel>{item.headerTitle}</SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-2">
                {item.items.map((item) => {
                  const isAvailable =
                    "comingSoon" in item ? !item.comingSoon : true;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={isActiveRoute(
                          navItemToPath(item.to),
                          pathname,
                          "match" in item ? (item.match as string[]) : undefined
                        )}
                        isAvailable={isAvailable}
                        render={
                          isAvailable ? (
                            <Link params={{ orgSlug }} to={item.to} />
                          ) : (
                            <button
                              className="text-sidebar-foreground/50 hover:bg-transparent hover:text-sidebar-foreground/50"
                              type="button"
                            />
                          )
                        }
                        tooltip={item.title}
                      >
                        {item.icon && (
                          <item.icon aria-hidden="true" variant="Broken" />
                        )}
                        <span>{item.title}</span>
                        {!isAvailable && (
                          <Badge size="xs" variant="warning-light">
                            Coming soon
                          </Badge>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarNavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
