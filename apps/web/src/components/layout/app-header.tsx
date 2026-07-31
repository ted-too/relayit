import { RiChatAi3Line, RiLayoutLeftLine, RiMoreLine } from "@remixicon/react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui/components/ui/coss/breadcrumb";
import { Button } from "@repo/ui/components/ui/coss/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/ui/coss/menu";
import { useSidebar } from "@repo/ui/components/ui/shad/sidebar";
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { findActiveNavItem, type NavItemGroup } from "./app-sidebar";

function getBreadcrumbSegments({
  items,
  pathname,
}: {
  items: NavItemGroup[];
  pathname: string;
}) {
  const active = findActiveNavItem({ items, pathname });
  if (!active) {
    return [];
  }

  const activeGroup = items.find((group) =>
    group.items.some((item) => item.to === active.item.to)
  );

  const segments: { title: string; to?: string }[] = [];

  const includeGroup = active.item.breadcrumb?.includeGroup;

  if (
    includeGroup &&
    activeGroup &&
    "headerTitle" in activeGroup &&
    activeGroup.headerTitle
  ) {
    segments.push({ title: activeGroup.headerTitle });
  }

  segments.push({ title: active.item.title, to: active.item.to });

  const trailingPath = pathname.slice(active.path.length);
  if (trailingPath.length > 0) {
    for (const segment of trailingPath.split("/").filter(Boolean)) {
      segments.push({ title: decodeURIComponent(segment) });
    }
  }

  return segments;
}

export function AppHeader({
  items,
  pathname,
  linkParams,
}: {
  items: NavItemGroup[];
  pathname: string;
  linkParams?: { orgSlug: string };
}) {
  const { toggleSidebar } = useSidebar();
  const breadcrumbs = getBreadcrumbSegments({ items, pathname });

  return (
    <div className="@container sticky top-0 z-50 flex h-14 flex-row items-center justify-between gap-2 bg-background-100 before:absolute before:inset-x-0 before:top-full before:h-px before:bg-gray-alpha-300 before:content-[&quot;&quot;] md:border-gray-100 md:border-b md:border-solid md:bg-background-200 md:before:content-[unset]">
      <div className="z-10 flex shrink-0 items-center pl-3">
        <Button onClick={toggleSidebar} size="icon" variant="ghost">
          <RiLayoutLeftLine aria-hidden="true" />
        </Button>
      </div>
      <div className="absolute left-1/2 flex max-w-[50%] -translate-x-1/2 items-center justify-center">
        {breadcrumbs.length > 0 && (
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                let label: ReactNode;

                if (isLast) {
                  label = <BreadcrumbPage>{crumb.title}</BreadcrumbPage>;
                } else if (crumb.to) {
                  label = (
                    <BreadcrumbLink
                      render={
                        <Link
                          className="hover:underline"
                          params={linkParams}
                          to={crumb.to}
                        />
                      }
                    >
                      {crumb.title}
                    </BreadcrumbLink>
                  );
                } else {
                  label = (
                    <span className="text-muted-foreground">{crumb.title}</span>
                  );
                }

                return (
                  <Fragment key={`${crumb.title}-${index}`}>
                    {index > 0 && <BreadcrumbSeparator>/</BreadcrumbSeparator>}
                    <BreadcrumbItem>{label}</BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>
      <div className="flex items-center gap-1 pr-3">
        <Menu>
          <MenuTrigger render={<Button size="icon" variant="ghost" />}>
            <RiMoreLine aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup
            align="end"
            className="w-(--anchor-width) min-w-56!"
            sideOffset={4}
          >
            <MenuItem
              className="justify-between p-2"
              render={<Link to="/user/account" />}
            >
              <span>Give feedback</span>
              <RiChatAi3Line aria-hidden="true" />
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}
