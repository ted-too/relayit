"use client";

import { RiLogoutCircleLine, RiMore2Line, RiUserLine } from "@remixicon/react";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/base/dropdown-menu";
import { toast } from "@repo/ui/components/custom/sonner";
import { cn, getInitials } from "@repo/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useTRPC } from "@/integrations/trpc/react";

export function SideBarUserNav() {
  const navigate = useNavigate();
  const { auth } = useRouteContext({
    from: "/_authd",
  });
  const trpc = useTRPC();
  const {
    data: { user },
  } = useSuspenseQuery(trpc.auth.getSession.queryOptions());

  const { open } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="in-data-[state=expanded]:size-6 transition-[width,height] duration-200 ease-in-out">
                  <AvatarImage src={user.image ?? undefined} alt={user.name} />
                  <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="ms-1 grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                </div>
                <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent/50 in-[[data-slot=dropdown-menu-trigger]:hover]:bg-transparent">
                  <RiMore2Line className="size-5 opacity-40" size={20} />
                </div>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className={cn(
              "w-full rounded-md transition-[width] duration-200 ease-in-out",
              open ? "min-w-64" : "min-w-56"
            )}
            side={open ? "top" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuItem className="gap-3 px-1">
              <RiUserLine
                size={20}
                className="text-muted-foreground/70"
                aria-hidden="true"
              />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-3 px-1"
              onSelect={async () => {
                const { error } = await auth.signOut();
                if (error) {
                  return toast.error("Failed to sign out", {
                    description: error.message,
                  });
                }
                navigate({ to: "/auth/sign-in", reloadDocument: true });
              }}
            >
              <RiLogoutCircleLine
                size={20}
                className="text-muted-foreground/70"
                aria-hidden="true"
              />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
