import { RiAddLine, RiExpandUpDownLine } from "@remixicon/react";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@repo/ui/components/ui/coss/menu";
import { Logo } from "@repo/ui/components/ui/custom/logo";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui/components/ui/shad/sidebar";
import { cn } from "@repo/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Image } from "@unpic/react";
import { queries } from "@/integrations/queries";

export function OrganizationLogo({
  name,
  logo,
  size = 16,
  className,
}: {
  name: string;
  logo?: string | null;
  size?: number;
  className?: string;
}) {
  if (logo) {
    return (
      <Image
        alt={name}
        className={cn("size-4", className)}
        height={size}
        layout="constrained"
        src={logo}
        width={size}
      />
    );
  }

  return (
    <Logo className={cn("size-4 rounded-full", className)} variant="icon" />
  );
}

export function NavProject() {
  const { isMobile } = useSidebar();
  const { orgSlug } = useParams({
    from: "/_authd/$orgSlug",
  });
  const { data: organizations } = useSuspenseQuery(
    queries.session.me.organizations.list
  );

  const activeOrganization = organizations.find(
    (organization) => organization.slug === orgSlug
  );

  if (!activeOrganization) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={
              <SidebarMenuButton
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                size="lg"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg text-sidebar-primary-foreground">
              <OrganizationLogo
                className="size-6!"
                logo={activeOrganization.logo}
                name={activeOrganization.name}
                size={24}
              />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">
                {activeOrganization.name}
              </span>
              {/* <span className="truncate text-xs">{activeTeam.plan}</span> */}
            </div>
            <RiExpandUpDownLine className="ml-auto" />
          </MenuTrigger>
          <MenuPopup
            align="start"
            className="w-(--anchor-width) min-w-56!"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <MenuGroup>
              <MenuGroupLabel className="text-muted-foreground text-xs">
                Teams
              </MenuGroupLabel>
              {organizations.map((organization, index) => (
                <MenuItem
                  className="gap-2 p-2"
                  key={organization.name}
                  render={
                    <Link
                      params={{ orgSlug: organization.slug }}
                      to="/$orgSlug"
                    />
                  }
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <OrganizationLogo
                      className="shrink-0"
                      logo={organization.logo}
                      name={organization.name}
                    />
                  </div>
                  {organization.name}
                  <MenuShortcut>⌘{index + 1}</MenuShortcut>
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuItem
              className="gap-2 p-2"
              render={<Link to="/create-project" />}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <RiAddLine className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">
                Create a project
              </div>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
