"use client";

import { RiExpandUpDownLine } from "@remixicon/react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui/components/animate-ui/components/radix/sidebar";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/base/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@repo/ui/components/base/dropdown-menu";
import { cn, getInitials } from "@repo/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTRPC } from "@/integrations/trpc/react";

export function ProjectSwitcher() {
  const navigate = useNavigate();
  const { open } = useSidebar();
  const { projectSlug } = useParams({
    from: "/_authd/$projectSlug",
  });
  const trpc = useTRPC();
  const {
    data: { session, user, userOrganizations },
  } = useSuspenseQuery(trpc.auth.getSession.queryOptions());

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="gap-3 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground [&>svg]:size-auto"
              >
                <Avatar className="in-data-[state=expanded]:size-8 rounded-md transition-[width,height] duration-200 ease-in-out">
                  <AvatarImage
                    src={session.activeOrganization?.logo ?? undefined}
                    alt={session.activeOrganization?.name}
                  />
                  <AvatarFallback>
                    {getInitials(session.activeOrganization?.name ?? user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-base leading-tight">
                  <span className="truncate font-medium">
                    {session.activeOrganization?.name}
                  </span>
                </div>
                <RiExpandUpDownLine
                  className="ms-auto text-muted-foreground/60"
                  size={20}
                  aria-hidden="true"
                />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className={cn(
              "w-full rounded-md transition-[width] duration-200 ease-in-out",
              open ? "min-w-64" : "min-w-56"
            )}
            align="end"
            side={open ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel className="text-muted-foreground/60 text-xs uppercase">
                Projects
              </DropdownMenuGroupLabel>
              {userOrganizations.map((organisation, index) => (
                <DropdownMenuItem
                  key={organisation.name}
                  onClick={() => {
                    navigate({
                      to: "/$projectSlug",
                      params: { projectSlug: organisation.slug },
                    });
                  }}
                  data-active={projectSlug === organisation.slug}
                  className="gap-2 p-2"
                >
                  <Avatar className="size-6 rounded-md">
                    <AvatarImage
                      src={organisation.logo ?? undefined}
                      alt={organisation.name}
                    />
                    <AvatarFallback>
                      {getInitials(organisation.name)}
                    </AvatarFallback>
                  </Avatar>
                  {organisation.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
              {/* TODO: Make this work */}
              {/* <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 p-2">
                <RiAddLine
                  className="opacity-60"
                  size={16}
                  aria-hidden="true"
                />
                <div className="font-medium">Add project</div>
              </DropdownMenuItem> */}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
