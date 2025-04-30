"use client";

import { DialogAction } from "@/components/shared/dialog-action";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { cn } from "@/lib/utils";
import {
	invitationsListQueryOptions,
	userOrganizationsQueryKey,
	userOrganizationsQueryOptions,
} from "@/qc/queries/user";
import {
	authClient,
	type Organization,
	type OrganizationMember,
} from "@/lib/auth-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Brodcast,
	Category2,
	Global,
	type IconProps,
	Warning2,
} from "iconsax-react";
import {
	BellIcon,
	BookIcon,
	BuildingIcon,
	ChevronRightIcon,
	ChevronsUpDownIcon,
	KeyRoundIcon,
	LibraryBigIcon,
	Loader2Icon,
	type LucideIcon,
	PlusIcon,
	TestTubesIcon,
} from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { OrganizationLogo, SideBarUserNav } from "@/components/layout/user-nav";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	Dialog,
	DialogTitle,
	DialogHeader,
	DialogFooter,
	DialogContent,
	DialogDescription,
	DialogTrigger,
} from "@/components/ui/dialog";
import { CreateOrganizationForm } from "@/components/forms/create-org";

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
	resources: NavItem[];
	settings: NavItem[];
	help: ExternalLink[];
};

// Define menu items structure
const MENU: Menu = {
	resources: [
		{
			title: "Events",
			url: "/events",
			icon: Brodcast,
		},
		{
			title: "Request Logs",
			url: "/request-logs",
			icon: Global,
		},
		{
			title: "Metrics",
			url: "/metrics",
			icon: TestTubesIcon,
			isAvailable: false,
		},
	],

	settings: [
		{
			title: "Alerts",
			url: "/alerts",
			icon: Warning2,
			isAvailable: false,
		},
		{
			title: "Organization Settings",
			url: "/organization",
			icon: BuildingIcon,
			isEnabled: (userMembership) =>
				["admin", "owner"].includes(userMembership.role),
			isAvailable: false,
		},
		{
			title: "Project Settings",
			url: "/project",
			icon: LibraryBigIcon,
			isEnabled: (userMembership) =>
				["admin", "owner"].includes(userMembership.role),
			isAvailable: false,
		},
		{
			title: "API Keys",
			url: "/api-keys",
			icon: KeyRoundIcon,
		},
	],

	help: [
		{
			name: "Documentation",
			url: "https://logsicle.app/docs",
			icon: BookIcon,
			isAvailable: false,
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
		resources: menu.resources.filter((item) =>
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
 */
function isActiveRoute(itemUrl: string, pathname: string): boolean {
	if (!pathname) return false;

	const itemUrlParts = itemUrl.split("/").slice(3).join("/");

	if (pathname === "/") return itemUrlParts === "";
	if (!itemUrlParts) return false;

	if (pathname === itemUrlParts) return true;

	if (pathname.startsWith(itemUrlParts)) {
		const nextChar = pathname.charAt(itemUrlParts.length);
		return nextChar === "/";
	}

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
	const queryClient = useQueryClient();

	const { data: userOrgs, isLoading } = useQuery(
		userOrganizationsQueryOptions(),
	);

	const activeOrganization = userOrgs?.find(
		(org) => org.id === currentUserOrg.id,
	);

	return (
		<Dialog>
			{isLoading ? (
				<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[5vh] pt-4">
					<Loader2Icon className="animate-spin size-4" />
				</div>
			) : (
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
							<DropdownMenuTrigger asChild>
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
										<div className="flex items-center justify-center transition-all rounded-full size-8">
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
											queryKey: userOrganizationsQueryKey,
										});

										router.push(`/~/${value}`);
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
			)}
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
	const { data: invitations, refetch: refetchInvitations } = useQuery(
		invitationsListQueryOptions(),
	);

	const { refetch: refetchUserOrgs } = useQuery(
		userOrganizationsQueryOptions(),
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
	sidebarStates: {
		sidebarState: boolean;
	};
}

export function AppSidebar({
	children,
	currentUserOrg,
	currentUserOrgMember,
	sidebarStates,
}: AppSidebarProps) {
	const pathname = usePathname();

	const filteredMenu = filterMenuForUser(MENU, currentUserOrgMember);

	return (
		<SidebarProvider
			defaultOpen={sidebarStates.sidebarState}
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
							<SidebarMenuButton asChild tooltip="Dashboard">
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
						<SidebarGroupLabel>Resources</SidebarGroupLabel>
						<SidebarMenu>
							{filteredMenu.resources.map((item) => (
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
						<SidebarTrigger className="group-data-[collapsible=]:translate-x-0.5" />
						<SidebarMenuItem className="min-h-12 flex items-center">
							<SideBarUserNav />
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			<SidebarInset>
				<div
					className="flex flex-col w-full pl-2 pt-4"
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
