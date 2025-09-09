"use client";

import {
  ORGANIZATION_LOGO_GRADIENTS,
  type OrganizationMetadata,
} from "@repo/shared";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/base/dropdown-menu";
import { SidebarMenuButton } from "@repo/ui/components/base/sidebar";
import { toast } from "@repo/ui/components/custom/sonner";
import { cn, getInitials } from "@repo/ui/lib/utils";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronsUpDownIcon } from "lucide-react";

export function SideBarUserNav() {
  const navigate = useNavigate();
  const { user, auth } = useRouteContext({
    from: "/_authd",
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            size="lg"
          >
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage alt={user.image || ""} src={user.image || ""} />
              <AvatarFallback className="rounded-lg">
                {getInitials(
                  user.name && user.name !== ""
                    ? user.name
                    : (user.email.split("@")[0] ?? "")
                )}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </SidebarMenuButton>
        }
      />
      <DropdownMenuContent
        align="end"
        className="min-w-56 rounded-lg"
        side="right"
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel className="flex flex-col text-left">
            Logged in as
            <span className="font-normal text-muted-foreground text-xs">
              {user.email}
            </span>
          </DropdownMenuGroupLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer"
            render={<Link to="/settings/profile">Profile</Link>}
          />
          <DropdownMenuItem
            className="cursor-pointer"
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
            Log out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OrganizationLogo({
  logoUrl,
  orgMetadata,
  name = "",
  size = "md",
}: {
  logoUrl?: string | null;
  orgMetadata?: OrganizationMetadata | null;
  name?: string;
  size?: "sm" | "md";
}) {
  if (logoUrl || !orgMetadata?.logoEmoji) {
    return (
      <Avatar
        className={cn(
          "shrink-0",
          size === "sm" && "size-6 text-xs",
          size === "md" && "size-8"
        )}
      >
        <AvatarImage alt={name} src={logoUrl ?? undefined} />
        <AvatarFallback>{getInitials(name)}</AvatarFallback>
      </Avatar>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        !orgMetadata?.logoBgKey && "bg-muted",
        size === "sm" && "size-6",
        size === "md" && "size-8"
      )}
      style={{
        background: orgMetadata?.logoBgKey
          ? ORGANIZATION_LOGO_GRADIENTS[orgMetadata.logoBgKey]
          : undefined,
      }}
    >
      <span
        className={cn({ sm: "text-base", md: "text-lg" }[size], "leading-none")}
      >
        {orgMetadata.logoEmoji}
      </span>
    </div>
  );
}
