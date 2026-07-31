import {
  RiExpandUpDownLine,
  RiLogoutBoxLine,
  RiUserLine,
  RiWalletLine,
} from "@remixicon/react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/ui/coss/avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  type MenuPopupProps,
  MenuSeparator,
  MenuTrigger,
  type MenuTriggerProps,
} from "@repo/ui/components/ui/coss/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui/components/ui/shad/sidebar";
import { getInitials } from "@repo/ui/lib/utils";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import { queries } from "@/integrations/queries";

export function NavUser({
  render,
  triggerIcon,
  side = "bottom",
  hideDetails = false,
}: {
  render?: MenuTriggerProps["render"];
  side?: MenuPopupProps["side"];
  triggerIcon?: React.ReactNode;
  hideDetails?: boolean;
}) {
  const { data } = useSuspenseQuery(queries.session.me);
  const navigate = useNavigate();
  const { betterAuth } = useRouteContext({
    from: "/_authd",
  });
  const { mutateAsync } = useMutation({
    mutationFn: async () => {
      const { error } = await betterAuth.signOut();
      if (error) {
        return Promise.reject(error);
      }
    },
    onSuccess: (_, __, ___, { client }) => {
      client.invalidateQueries({
        queryKey: queries.session.me.queryKey,
      });
      navigate({ to: "/auth/sign-in", reloadDocument: true });
    },
    onError: (error) => {
      toast.error("Failed to sign out", {
        description: error.message,
      });
    },
  });

  return (
    <Menu>
      <MenuTrigger render={render}>
        <Avatar className="h-8 w-8 rounded-full">
          <AvatarImage
            alt={data.user.name}
            src={data.user.image ?? undefined}
          />
          <AvatarFallback>{getInitials(data.user.name)}</AvatarFallback>
        </Avatar>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium text-sidebar-accent-foreground">
            {data.user.name}
          </span>
          <span className="truncate text-xs">{data.user.email}</span>
        </div>
        {triggerIcon ?? <RiExpandUpDownLine className="ml-auto" />}
      </MenuTrigger>
      <MenuPopup
        align="end"
        className="w-(--anchor-width) min-w-56!"
        side={side}
        sideOffset={4}
      >
        {!hideDetails && (
          <>
            <MenuGroup>
              <MenuGroupLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-full">
                    <AvatarImage
                      alt={data.user.name}
                      src={data.user.image ?? undefined}
                    />
                    <AvatarFallback>
                      {getInitials(data.user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {data.user.name}
                    </span>
                    <span className="truncate text-xs">{data.user.email}</span>
                  </div>
                </div>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
          </>
        )}
        <MenuItem render={<Link to="/user/account" />}>
          <RiUserLine aria-hidden="true" />
          <span>Account</span>
        </MenuItem>
        <MenuItem render={<Link to="/user/billing" />}>
          <RiWalletLine aria-hidden="true" />
          <span>Usage & Billing</span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={async () => await mutateAsync()}>
          <RiLogoutBoxLine aria-hidden="true" />
          <span>Log out</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function SidebarNavUser() {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <NavUser
          render={
            <SidebarMenuButton
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              size="lg"
            />
          }
          side={isMobile ? "bottom" : "right"}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
