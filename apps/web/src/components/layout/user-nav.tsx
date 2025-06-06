"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/shadcn/avatar";
import { Button } from "@repo/ui/components/shadcn/button";
import { ModeToggle } from "@repo/ui/components/shadcn/dark-mode-toggle";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui/components/shadcn/dropdown-menu";
import { SidebarMenuButton } from "@repo/ui/components/shadcn/sidebar";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { authClient } from "@/lib/auth-client";
import { cn, getInitials } from "@repo/ui/lib/utils";
import { sessionQueryOptions } from "@/trpc/queries/auth";
import {
	ORGANIZATION_LOGO_GRADIENTS,
	type OrganizationMetadata,
} from "@repo/shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon } from "lucide-react";
import { LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function LogoutButton({
	size = "md",
	className,
}: {
	size?: "sm" | "md";
	className?: string;
}) {
	const router = useRouter();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					className={cn(
						"h-max p-0! w-max",
						size === "sm" && "[&_svg:not([class*='size-'])]:size-3",
						size === "md" && "[&_svg:not([class*='size-'])]:size-4",
						className,
					)}
					variant="link"
					onClick={async () => {
						const { error } = await authClient.signOut();
						if (error) {
							toast.error("Failed to sign out");
							return;
						}
						router.refresh();
					}}
				>
					<LogOutIcon />
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				<p>Sign out</p>
			</TooltipContent>
		</Tooltip>
	);
}

export function SideBarUserNav({ orgSlug }: { orgSlug?: string }) {
	const router = useRouter();
	const { data: session, isPending: sessionPending } = useQuery(
		sessionQueryOptions(),
	);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				{sessionPending || !session ? (
					<Skeleton className="h-8 w-8 rounded-lg" />
				) : (
					<SidebarMenuButton
						size="lg"
						className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
					>
						<Avatar className="h-8 w-8 rounded-lg">
							<AvatarImage
								src={session.user.image || ""}
								alt={session.user.image || ""}
							/>
							<AvatarFallback className="rounded-lg">
								{getInitials(session.user.name)}
							</AvatarFallback>
						</Avatar>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-semibold">
								{session.user.name}
							</span>
							<span className="truncate text-xs">{session.user.email}</span>
						</div>
						<ChevronsUpDownIcon className="ml-auto size-4" />
					</SidebarMenuButton>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
				side="right"
				align="end"
				sideOffset={4}
			>
				<div className="flex items-center justify-between px-2 py-1.5">
					<DropdownMenuLabel className="flex flex-col">
						My account
						<span className="text-xs font-normal text-muted-foreground">
							{session?.user.email}
						</span>
					</DropdownMenuLabel>
					<ModeToggle />
				</div>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem className="cursor-pointer" asChild>
						<Link href={`/~/${orgSlug}/settings/profile`}>Profile</Link>
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="cursor-pointer"
					onSelect={async () => {
						const { error } = await authClient.signOut();
						if (error) {
							toast.error("Failed to sign out");
							return;
						}
						router.refresh();
					}}
				>
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function OrganizationLogo({
	logoUrl,
	orgMetadata,
	name,
	size = "md",
}: {
	logoUrl: string | null | undefined;
	orgMetadata: OrganizationMetadata | null | undefined;
	name: string;
	size?: "sm" | "md";
}) {
	if (logoUrl || !orgMetadata?.logoEmoji)
		return (
			<Avatar
				className={cn(
					"shrink-0",
					size === "sm" && "size-6 text-xs",
					size === "md" && "size-8",
				)}
			>
				<AvatarImage src={logoUrl ?? undefined} alt={name} />
				<AvatarFallback>{getInitials(name)}</AvatarFallback>
			</Avatar>
		);

	return (
		<div
			className={cn(
				"shrink-0 flex items-center justify-center rounded-full",
				!orgMetadata?.logoBgKey && "bg-muted",
				size === "sm" && "size-6",
				size === "md" && "size-8",
			)}
			style={{
				background: orgMetadata?.logoBgKey
					? ORGANIZATION_LOGO_GRADIENTS[orgMetadata.logoBgKey]
					: undefined,
			}}
		>
			<span className={cn({ sm: "text-base", md: "text-xl" }[size])}>
				{orgMetadata.logoEmoji}
			</span>
		</div>
	);
}
