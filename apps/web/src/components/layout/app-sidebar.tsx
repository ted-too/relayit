"use client";

import { OrganizationLogo, SideBarUserNav } from "@/components/layout/user-nav";
import { DialogAction } from "@/components/shared/dialog-action";
import { CreateOrganizationForm } from "@/components/shared/forms/create-org";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { SIDEBAR_KEYBOARD_SHORTCUT } from "@/constants/keybinds";
import {
	type Organization,
	type OrganizationMember,
	authClient,
} from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";
import {
	activeOrganizationQueryKey,
	usersOrganizationsQueryOptions,
} from "@/trpc/queries/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Category2, type IconProps } from "iconsax-react";
import {
	BellIcon,
	BookIcon,
	BuildingIcon,
	ChevronRightIcon,
	ChevronsUpDownIcon,
	FolderIcon,
	KeyRoundIcon,
	LineChartIcon,
	type LucideIcon,
	MessagesSquareIcon,
	PlugZapIcon,
	PlusIcon,
	ScrollTextIcon,
	WebhookIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import type * as React from "react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Kbd } from "@/components/ui/kbd";

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
			title: "Messages",
			url: "/messages", // Central place to view message status and history
			icon: MessagesSquareIcon,
		},
		{
			title: "Projects",
			url: "/projects", // Central place to view projects
			icon: FolderIcon,
		},
		{
			title: "Logs",
			url: "/logs", // For more detailed logs (API requests, processing)
			icon: ScrollTextIcon,
			isAvailable: false, // Mark as future feature if not implemented
		},
		{
			title: "Metrics",
			url: "/metrics", // High-level performance overview
			icon: LineChartIcon,
			isAvailable: false,
		},
	],

	settings: [
		{
			title: "Providers",
			url: "/providers", // Manage service credentials (SES, SNS, etc.)
			icon: PlugZapIcon,
		},
		{
			title: "Webhooks",
			url: "/webhooks", // Configure endpoints for status updates
			icon: WebhookIcon,
		},
		{
			title: "API Keys",
			url: "/api-keys", // Manage keys for sending messages
			icon: KeyRoundIcon,
		},
		{
			title: "Organization Settings",
			url: "/settings/organization", // Manage org members, invites, etc.
			icon: BuildingIcon,
			isEnabled: (userMembership) =>
				["admin", "owner"].includes(userMembership.role),
		},
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
	userMembership: OrganizationMember,
): Menu {
	return {
		activity: menu.activity.filter((item) =>
			!item.isEnabled ? true : item.isEnabled(userMembership),
		),
		settings: menu.settings.filter((item) =>
			!item.isEnabled ? true : item.isEnabled(userMembership),
		),
		help: menu.help.filter((item) =>
			!item.isEnabled ? true : item.isEnabled(userMembership),
		),
	};
}

/**
 * Checks if a route is active based on current pathname
 * TODO: Fix sub menu items
 */
function isActiveRoute(itemUrl: string, pathname: string): boolean {
	if (!pathname) return false;

	const pathnameParts = `/${pathname.split("/").slice(3).join("/")}`;

	if (itemUrl === "/") return pathname === pathnameParts;

	if (pathnameParts.startsWith(itemUrl)) return true;

	return false;
}

/**
 * Organization logo and selector component
 */
function SidebarLogo({
	currentUserOrg,
}: {
	currentUserOrg: Organization;
}) {
	const { state, isMobile } = useSidebar();
	const router = useRouter();
	const pathname = usePathname();
	const activePage = pathname.split("/").slice(3).join("/");

	const queryClient = useQueryClient();

	const { data: userOrgs, isPending } = useQuery(
		usersOrganizationsQueryOptions(),
	);

	const activeOrganization = userOrgs?.find(
		(org) => org.id === currentUserOrg.id,
	);

	return (
		<Dialog>
			<SidebarMenu
				className={cn(
					"flex gap-2",
					state === "collapsed"
						? "flex-col"
						: "flex-row justify-between items-center",
				)}
			>
				<SidebarMenuItem className="w-full">
					<DropdownMenu>
						<DropdownMenuTrigger disabled={isPending} asChild>
							{isPending ? (
								<Skeleton
									className={cn(
										"h-12 w-full",
										state === "collapsed" && "size-8 rounded-full",
									)}
								/>
							) : (
								<SidebarMenuButton
									size="lg"
									className={cn(
										"data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
										state === "collapsed" && "h-10 w-10 rounded-full",
									)}
								>
									<div
										className={cn(
											"flex items-center gap-2  min-w-0",
											state === "collapsed" && "justify-center",
										)}
									>
										<div
											className="flex items-center justify-center transition-all rounded-full size-8"
											suppressHydrationWarning={true}
										>
											<OrganizationLogo
												logoUrl={activeOrganization?.logo}
												orgMetadata={activeOrganization?.metadata}
												name={activeOrganization?.name ?? ""}
												size="sm"
											/>
										</div>
										<div
											className={cn(
												"text-sm font-medium leading-none truncate",
												state === "collapsed" && "hidden",
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
							className="rounded-lg w-56"
							align="start"
							side={isMobile ? "bottom" : "right"}
							sideOffset={4}
						>
							<DropdownMenuLabel className="text-xs text-muted-foreground">
								Organizations
							</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={currentUserOrg.slug}
								onValueChange={async (value) => {
									const { error } = await authClient.organization.setActive({
										organizationSlug: value,
									});

									if (error) {
										toast.error(
											error.message || "Error setting active organization",
										);
									}

									queryClient.invalidateQueries({
										queryKey: activeOrganizationQueryKey,
									});

									router.push(`/~/${value}/${activePage}`);
								}}
							>
								{userOrgs?.map((org) => (
									<DropdownMenuRadioItem
										key={org.id}
										value={org.slug}
										className="justify-between min-w-0"
									>
										<span className="truncate">{org.name}</span>
										<OrganizationLogo
											logoUrl={org.logo}
											orgMetadata={org.metadata}
											name={org.name}
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
			key={item.title}
			asChild
			defaultOpen={isActive}
			className="group/collapsible"
		>
			<SidebarMenuItem>
				{!hasSubitems ? (
					<SidebarMenuButton
						isAvailable={item.isAvailable}
						asChild
						tooltip={item.title}
					>
						<Link
							href={`/~/${orgSlug}${item.url}`}
							data-active={isActive}
							className="flex w-full items-center gap-2"
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
				) : (
					<>
						<CollapsibleTrigger asChild>
							<SidebarMenuButton
								isAvailable={item.isAvailable}
								tooltip={item.title}
								isActive={isActive}
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
												href={`/~/${orgSlug}${subItem.url}`}
												data-active={isActiveRoute(subItem.url, pathname)}
												className="flex w-full items-center"
											>
												{subItem.icon && (
													<span className="mr-2">
														<subItem.icon
															className={cn(
																"h-4 w-4 text-muted-foreground",
																isActive && "text-secondary-foreground",
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
				)}
			</SidebarMenuItem>
		</Collapsible>
	);
}

function SidebarNotifications() {
	const { data: invitations, refetch: refetchInvitations } =
		trpc.misc.listInvitations.useQuery();

	const { refetch: refetchUserOrgs } = useQuery(
		usersOrganizationsQueryOptions(),
	);

	return (
		<SidebarMenuItem className="group-data-[collapsible=icon]:-translate-x-0.5">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="relative h-8 w-8 p-1.5 mx-auto"
					>
						<BellIcon className="size-4" />
						{invitations && invitations.length > 0 && (
							<span className="absolute -top-0 -right-0 flex size-4 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
								{invitations.length}
							</span>
						)}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" side="right" className="w-80">
					<DropdownMenuLabel>Pending Invitations</DropdownMenuLabel>
					{/* TODO: Add a loading state */}
					<div className="flex flex-col gap-2">
						{invitations && invitations.length > 0 ? (
							invitations.map((invitation) => (
								<div key={invitation.id} className="flex flex-col gap-2">
									<DropdownMenuItem
										className="flex flex-col items-start gap-1 p-3"
										onSelect={(e) => e.preventDefault()}
									>
										<div className="font-medium">
											{invitation?.organization?.name}
										</div>
										<div className="text-xs text-muted-foreground">
											Expires: {new Date(invitation.expiresAt).toLocaleString()}
										</div>
										<div className="text-xs text-muted-foreground">
											Role: {invitation.role}
										</div>
									</DropdownMenuItem>
									<DialogAction
										title="Accept Invitation"
										description="Are you sure you want to accept this invitation?"
										type="default"
										onClick={async () => {
											const { error } =
												await authClient.organization.acceptInvitation({
													invitationId: invitation.id,
												});

											if (error) {
												toast.error(
													error.message || "Error accepting invitation",
												);
											} else {
												toast.success("Invitation accepted successfully");
												await refetchInvitations();
												await refetchUserOrgs();
											}
										}}
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
interface AppSidebarProps {
	children: React.ReactNode;
	currentUserOrg: Organization;
	currentUserOrgMember: OrganizationMember;
	sidebarOpen: boolean;
}

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
								isAvailable={false}
								asChild
								tooltip="Dashboard"
							>
								<Link
									href={`/~/${currentUserOrg.slug}`}
									data-active={isActiveRoute(`/~/${currentUserOrg.slug}`, "/")}
									className="flex w-full items-center gap-2"
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
									key={item.title}
									item={item}
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
									key={item.title}
									item={item}
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
									<SidebarMenuButton isAvailable={item.isAvailable} asChild>
										<a
											href={item.url}
											target="_blank"
											rel="noopener noreferrer"
											className="flex w-full items-center gap-2"
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
						<SidebarMenuItem className="min-h-12 flex items-center">
							<SideBarUserNav />
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			<SidebarInset>
				<div
					className="flex flex-col size-full pl-2 py-4"
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
