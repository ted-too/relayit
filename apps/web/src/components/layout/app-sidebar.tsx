import type { statement } from "@repo/persistence/auth/permissions";
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
import { Link } from "@tanstack/react-router";
import type { Icon } from "iconsax-reactjs";
import { NavProject } from "./nav-projects";
import { SidebarNavUser } from "./nav-user";

export type PermissionStatements = typeof statement;

export type RequiredPermissions = {
  [K in keyof PermissionStatements]?: PermissionStatements[K][number][];
};

export interface NavItem {
  breadcrumb?: {
    /** Include the sidebar group headerTitle in the breadcrumb trail */
    includeGroup?: boolean;
  };
  comingSoon?: boolean;
  icon: Icon;
  match?: string[];
  requiredPermissions?: RequiredPermissions | RequiredPermissions[];
  title: string;
  to: string;
}

export interface NavItemGroup {
  headerTitle?: string;
  items: NavItem[];
}

export const navItemToPath = (to: string): string =>
  to.replace("/$orgSlug/", "/").replace("/$orgSlug", "/");

export function isActiveRoute(
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

export function findActiveNavItem({
  items,
  pathname,
}: {
  items: NavItemGroup[];
  pathname: string;
}) {
  let best: { item: NavItem; path: string } | null = null;

  for (const group of items) {
    for (const item of group.items) {
      const itemPath = navItemToPath(item.to);
      const match = "match" in item ? (item.match as string[]) : undefined;

      if (!isActiveRoute(itemPath, pathname, match)) {
        continue;
      }

      if (!best || itemPath.length > best.path.length) {
        best = { item, path: itemPath };
      }
    }
  }

  return best;
}

export function AppSidebar({
  items,
  pathname,
  linkParams,
}: {
  items: NavItemGroup[];
  pathname: string;
  linkParams?: { orgSlug: string };
}) {
  const activeNavItem = findActiveNavItem({ items, pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <NavProject linkParams={linkParams} />
      </SidebarHeader>
      <SidebarContent>
        {items.map((item, idx) => (
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
                        isActive={activeNavItem?.item.to === item.to}
                        isAvailable={isAvailable}
                        render={
                          isAvailable ? (
                            <Link params={linkParams} to={item.to} />
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
