"use client";

import { Button } from "@repo/ui/components/shadcn/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@repo/ui/components/shadcn/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/ui/components/shadcn/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui/components/shadcn/dropdown-menu";
import { Kbd } from "@repo/ui/components/shadcn/kbd";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "@repo/ui/components/shadcn/sidebar";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@repo/ui/components/shadcn/tooltip";
import { SIDEBAR_KEYBOARD_SHORTCUT } from "@repo/ui/constants";
import { cn } from "@repo/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Category2, type IconProps } from "iconsax-react";
import {
	BellIcon,
	BookIcon,
	ChevronRightIcon,
	ChevronsUpDownIcon,
	FolderIcon,
	KeyRoundIcon,
	type LucideIcon,
	MessagesSquareIcon,
	PlugZapIcon,
	PlusIcon,
	SettingsIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type * as React from "react";
import { toast } from "sonner";
import { OrganizationLogo, SideBarUserNav } from "@/components/layout/user-nav";
import { DialogAction } from "@/components/shared/dialog-action";
import { CreateOrganizationForm } from "@/components/shared/forms/create-org";
import {
	authClient,
	type Organization,
	type OrganizationMember,
} from "@/lib/auth-client";
import { trpc } from "@/trpc/client";
import {
	activeOrganizationQueryKey,
	usersOrganizationsQueryOptions,
} from "@/trpc/queries/auth";

/**
 * Core types for sidebar navigation
 */
type Icon = LucideIcon | React.ComponentType<IconProps>;

// A single navigation item
type NavItem = {
	title: string;
	url: string;
	icon?: Icon;
	isEnabled?: (userMembership: OrganizationMember) => boolean;
	isAvailable?: boolean;
	items?: NavItem[]; // For grouped items
};

// External link (for help section)
type ExternalLink = {
	name: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	isEnabled?: (userMembership: OrganizationMember) => boolean;
	isAvailable?: boolean;
};

// Complete menu structure
type Menu = {
	activity: NavItem[];
	settings: NavItem[];
	help: ExternalLink[];
};

const MENU: Menu = {
	activity: [
		{
			title: "Projects",
			url: "/projects", // Central place to view projects
			icon: FolderIcon,
		},
		{
			title: "Messages",
			url: "/messages", // Central place to view message status and history
			icon: MessagesSquareIcon,
		},
		// {
		// 	title: "Logs",
		// 	url: "/logs", // For more detailed logs (API requests, processing)
		// 	icon: ScrollTextIcon,
		// 	isAvailable: false,
		// },
		// {
		// 	title: "Metrics",
		// 	url: "/metrics", // High-level performance overview
		// 	icon: LineChartIcon,
		// 	isAvailable: false,
		// },
	],

	settings: [
		{
			title: "Providers",
			url: "/providers", // Manage service credentials (SES, SNS, etc.)
			icon: PlugZapIcon,
		},
		{
			title: "API Keys",
			url: "/api-keys", // Manage keys for sending messages
			icon: KeyRoundIcon,
		},
		{
			title: "Settings",
			url: "/settings", // Manage org members, invites, etc.
			icon: SettingsIcon,
			isEnabled: (userMembership) =>
				["admin", "owner"].includes(userMembership.role),
		},
		// {
		// 	title: "Webhooks",
		// 	url: "/webhooks", // Configure endpoints for status updates
		// 	icon: WebhookIcon,
		// 	isAvailable: false,
		// },
	],
	help: [
		{
			name: "Documentation",
			url: process.env.NEXT_PUBLIC_DOCS_URL,
			icon: BookIcon,
		},
	],
};

/**
 * Filters menu items based on user's role and permissions
 */
function filterMenuForUser(
	menu: Menu,
	userMembership: OrganizationMember
): Menu {
	return {
		activity: menu.activity.filter((item) =>
			item.isEnabled ? item.isEnabled(userMembership) : true
		),
		settings: menu.settings.filter((item) =>
			item.isEnabled ? item.isEnabled(userMembership) : true
		),
		help: menu.help.filter((item) =>
			item.isEnabled ? item.isEnabled(userMembership) : true
		),
	};
}

/**
 * Checks if a route is active based on current pathname
 * TODO: Fix sub menu items
 */
function isActiveRoute(itemUrl: string, pathname: string): boolean {
	if (!pathname) {
		return false;
	}

	const pathnameParts = `/${pathname.split("/").slice(3).join("/")}`;

	if (itemUrl === "/") {
		return pathname === pathnameParts;
	}

	if (pathnameParts.startsWith(itemUrl)) {
		return true;
	}

	return false;
}

/**
 * Organization logo and selector component
 */
function SidebarLogo({ currentUserOrg }: { currentUserOrg: Organization }) {
	const { state, isMobile } = useSidebar();
	const router = useRouter();
	const pathname = usePathname();
	const activePage = pathname.split("/").slice(3).join("/");

	const queryClient = useQueryClient();

	const { data: userOrgs, isPending } = useQuery(
		usersOrganizationsQueryOptions()
	);

	const activeOrganization = userOrgs?.find(
		(org) => org.id === currentUserOrg.id
	);

	return (
		<Dialog>
			<SidebarMenu
				className={cn(
					"flex gap-2",
					state === "collapsed"
						? "flex-col"
						: "flex-row items-center justify-between"
				)}
			>
				<SidebarMenuItem className="w-full">
					<DropdownMenu>
						<DropdownMenuTrigger asChild disabled={isPending}>
							{isPending ? (
								<Skeleton
									className={cn(
										"h-12 w-full",
										state === "collapsed" && "size-8 rounded-full"
									)}
								/>
							) : (
								<SidebarMenuButton
									className={cn(
										"data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
										state === "collapsed" && "h-10 w-10 rounded-full"
									)}
									size="lg"
								>
									<div
										className={cn(
											"flex min-w-0 items-center gap-2",
											state === "collapsed" && "justify-center"
										)}
									>
										<div
											className="flex size-8 items-center justify-center rounded-full transition-all"
											suppressHydrationWarning={true}
										>
											<OrganizationLogo
												logoUrl={activeOrganization?.logo}
												name={activeOrganization?.name ?? ""}
												orgMetadata={activeOrganization?.metadata}
												size="sm"
											/>
										</div>
										<div
											className={cn(
												"truncate font-medium text-sm leading-none",
												state === "collapsed" && "hidden"
											)}
										>
											{activeOrganization?.name ?? "Select Organization"}
										</div>
									</div>
									<ChevronsUpDownIcon
										className={cn("ml-auto", state === "collapsed" && "hidden")}
									/>
								</SidebarMenuButton>
							)}
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							className="w-56 rounded-lg"
							side={isMobile ? "bottom" : "right"}
							sideOffset={4}
						>
							<DropdownMenuLabel className="text-muted-foreground text-xs">
								Organizations
							</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								onValueChange={async (value) => {
									const { error } = await authClient.organization.setActive({
										organizationSlug: value,
									});

									if (error) {
										toast.error(
											error.message || "Error setting active organization"
										);
									}

									queryClient.invalidateQueries({
										queryKey: activeOrganizationQueryKey,
									});

									router.push(`/~/${value}/${activePage}`);
								}}
								value={currentUserOrg.slug}
							>
								{userOrgs?.map((org) => (
									<DropdownMenuRadioItem
										className="min-w-0 justify-between"
										key={org.id}
										value={org.slug}
									>
										<span className="truncate">{org.name}</span>
										<OrganizationLogo
											logoUrl={org.logo}
											name={org.name}
											orgMetadata={org.metadata}
											size="sm"
										/>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
							<DropdownMenuSeparator />
							<DialogTrigger asChild>
								<DropdownMenuItem>
									<PlusIcon className="size-4" />
									Create Organization
								</DropdownMenuItem>
							</DialogTrigger>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarMenuItem>
			</SidebarMenu>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Create Organization</DialogTitle>
					<DialogDescription>
						Create an organization to manage projects and providers.
					</DialogDescription>
				</DialogHeader>
				<CreateOrganizationForm
					onSuccess={({ slug }) => {
						router.push(`/~/${slug}`);
					}}
					submitWrapper={DialogFooter}
				/>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Renders a navigation item
 */
function NavItemComponent({
	item,
	orgSlug,
}: {
	item: NavItem;
	orgSlug: string;
}) {
	const pathname = usePathname();

	const hasSubitems = item.items && item.items.length > 0;
	const isActive = hasSubitems
		? item.items?.some((subItem) => isActiveRoute(subItem.url, pathname))
		: isActiveRoute(item.url, pathname);

	return (
		<Collapsible
			asChild
			className="group/collapsible"
			defaultOpen={isActive}
			key={item.title}
		>
			<SidebarMenuItem>
				{hasSubitems ? (
					<>
						<CollapsibleTrigger asChild>
							<SidebarMenuButton
								isActive={isActive}
								isAvailable={item.isAvailable}
								tooltip={item.title}
							>
								{item.icon && <item.icon color="currentColor" />}

								<span>{item.title}</span>
								{hasSubitems && (
									<ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
								)}
							</SidebarMenuButton>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<SidebarMenuSub>
								{item.items?.map((subItem) => (
									<SidebarMenuSubItem key={subItem.title}>
										<SidebarMenuSubButton asChild>
											<Link
												className="flex w-full items-center"
												data-active={isActiveRoute(subItem.url, pathname)}
												href={`/~/${orgSlug}${subItem.url}`}
											>
												{subItem.icon && (
													<span className="mr-2">
														<subItem.icon
															className={cn(
																"h-4 w-4 text-muted-foreground",
																isActive && "text-secondary-foreground"
															)}
														/>
													</span>
												)}
												<span>{subItem.title}</span>
											</Link>
										</SidebarMenuSubButton>
									</SidebarMenuSubItem>
								))}
							</SidebarMenuSub>
						</CollapsibleContent>
					</>
				) : (
					<SidebarMenuButton
						asChild
						isAvailable={item.isAvailable}
						tooltip={item.title}
					>
						<Link
							className="flex w-full items-center gap-2"
							data-active={isActive}
							href={`/~/${orgSlug}${item.url}`}
						>
							{item.icon && (
								<item.icon
									className={cn(isActive && "text-secondary-foreground")}
									color="currentColor"
								/>
							)}
							<span>{item.title}</span>
						</Link>
					</SidebarMenuButton>
				)}
			</SidebarMenuItem>
		</Collapsible>
	);
}

function SidebarNotifications() {
	const { data: invitations, refetch: refetchInvitations } =
		trpc.misc.listInvitations.useQuery();

	const { refetch: refetchUserOrgs } = useQuery(
		usersOrganizationsQueryOptions()
	);

	return (
		<SidebarMenuItem className="group-data-[collapsible=icon]:-translate-x-0.5">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						className="relative mx-auto h-8 w-8 p-1.5"
						size="icon"
						variant="ghost"
					>
						<BellIcon className="size-4" />
						{invitations && invitations.length > 0 && (
							<span className="-top-0 -right-0 absolute flex size-4 items-center justify-center rounded-full bg-blue-500 text-white text-xs">
								{invitations.length}
							</span>
						)}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-80" side="right">
					<DropdownMenuLabel>Pending Invitations</DropdownMenuLabel>
					{/* TODO: Add a loading state */}
					<div className="flex flex-col gap-2">
						{invitations && invitations.length > 0 ? (
							invitations.map((invitation) => (
								<div className="flex flex-col gap-2" key={invitation.id}>
									<DropdownMenuItem
										className="flex flex-col items-start gap-1 p-3"
										onSelect={(e) => e.preventDefault()}
									>
										<div className="font-medium">
											{invitation?.organization?.name}
										</div>
										<div className="text-muted-foreground text-xs">
											Expires: {new Date(invitation.expiresAt).toLocaleString()}
										</div>
										<div className="text-muted-foreground text-xs">
											Role: {invitation.role}
										</div>
									</DropdownMenuItem>
									<DialogAction
										description="Are you sure you want to accept this invitation?"
										onClick={async () => {
											const { error } =
												await authClient.organization.acceptInvitation({
													invitationId: invitation.id,
												});

											if (error) {
												toast.error(
													error.message || "Error accepting invitation"
												);
											} else {
												toast.success("Invitation accepted successfully");
												await refetchInvitations();
												await refetchUserOrgs();
											}
										}}
										title="Accept Invitation"
										type="default"
									>
										<Button size="sm" variant="secondary">
											Accept Invitation
										</Button>
									</DialogAction>
								</div>
							))
						) : (
							<DropdownMenuItem disabled>
								No pending invitations
							</DropdownMenuItem>
						)}
					</div>
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuItem>
	);
}

/**
 * Main sidebar component
 */
type AppSidebarProps = {
	children: React.ReactNode;
	currentUserOrg: Organization;
	currentUserOrgMember: OrganizationMember;
	sidebarOpen: boolean;
};

export function AppSidebar({
	children,
	currentUserOrg,
	currentUserOrgMember,
	sidebarOpen,
}: AppSidebarProps) {
	const filteredMenu = filterMenuForUser(MENU, currentUserOrgMember);

	return (
		<SidebarProvider
			defaultOpen={sidebarOpen}
			style={
				{
					"--sidebar-width": "19.5rem",
					"--sidebar-width-mobile": "19.5rem",
				} as React.CSSProperties
			}
		>
			<Sidebar collapsible="icon" variant="floating">
				<SidebarHeader>
					<SidebarLogo currentUserOrg={currentUserOrg} />
				</SidebarHeader>

				<SidebarContent>
					{/* Dashboard Link */}
					<SidebarGroup>
						<SidebarMenu>
							<SidebarMenuButton
								asChild
								isAvailable={false}
								tooltip="Dashboard"
							>
								<Link
									className="flex w-full items-center gap-2"
									data-active={isActiveRoute(`/~/${currentUserOrg.slug}`, "/")}
									href={`/~/${currentUserOrg.slug}`}
								>
									<Category2 color="currentColor" />
									<span>Dashboard</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenu>
					</SidebarGroup>

					{/* Resources */}
					<SidebarGroup>
						<SidebarGroupLabel>Activity</SidebarGroupLabel>
						<SidebarMenu>
							{filteredMenu.activity.map((item) => (
								<NavItemComponent
									item={item}
									key={item.title}
									orgSlug={currentUserOrg.slug}
								/>
							))}
						</SidebarMenu>
					</SidebarGroup>

					{/* Settings */}
					<SidebarGroup>
						<SidebarGroupLabel>Settings</SidebarGroupLabel>
						<SidebarMenu className="gap-1">
							{filteredMenu.settings.map((item) => (
								<NavItemComponent
									item={item}
									key={item.title}
									orgSlug={currentUserOrg.slug}
								/>
							))}
						</SidebarMenu>
					</SidebarGroup>

					{/* Extra / Help */}
					<SidebarGroup className="group-data-[collapsible=icon]:hidden">
						<SidebarGroupLabel>Extra</SidebarGroupLabel>
						<SidebarMenu>
							{filteredMenu.help.map((item) => (
								<SidebarMenuItem key={item.name}>
									<SidebarMenuButton asChild isAvailable={item.isAvailable}>
										<a
											className="flex w-full items-center gap-2"
											href={item.url}
											rel="noopener noreferrer"
											target="_blank"
										>
											<span className="mr-2">
												<item.icon className="h-4 w-4" />
											</span>
											<span>{item.name}</span>
										</a>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroup>
				</SidebarContent>

				<SidebarFooter>
					<SidebarMenu className="flex flex-col gap-2">
						<SidebarNotifications />
						<Tooltip>
							<TooltipTrigger asChild>
								<SidebarTrigger className="group-data-[collapsible=]:translate-x-0.5" />
							</TooltipTrigger>
							<TooltipContent side="right">
								<p>
									Open with{" "}
									<Kbd
										className="ml-1 text-muted-foreground group-hover:text-accent-foreground"
										shortcut={SIDEBAR_KEYBOARD_SHORTCUT}
									/>
								</p>
							</TooltipContent>
						</Tooltip>
						<SidebarMenuItem className="flex min-h-12 items-center">
							<SideBarUserNav />
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			<SidebarInset>
				<div
					className="flex size-full flex-col py-4 pr-3 pl-2"
					style={
						{
							"--content-height": "calc(100svh - 1rem)",
						} as React.CSSProperties
					}
				>
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
