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
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
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
import { listInvitationsQueryOptions } from "@/qc/teams/invitations";
import { listUserOrganizationMembershipsQueryOptions } from "@/qc/teams/organizations";
import { acceptInvitation } from "@/server/teams/invitations";
import type { TeamMembership } from "@repo/api";
import { useQuery } from "@tanstack/react-query";
import {
	Link,
	useParams,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import {
	Brodcast,
	Category2,
	Global,
	type IconProps,
	Warning2,
} from "iconsax-react";
import {
	Bell,
	BookIcon,
	BuildingIcon,
	ChevronRight,
	ChevronsUpDown,
	KeyRoundIcon,
	LibraryBigIcon,
	Loader2,
	type LucideIcon,
	TestTubesIcon,
} from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { LogsIcon, TracesIcon } from "../icons";
import { Logo } from "../shared/logo";
import { AddOrganization } from "../teams/add-org";
import { AddProject } from "../teams/add-project";
import { UserNav } from "./user-nav";

/**
 * Core types for sidebar navigation
 */
type Icon = LucideIcon | React.ComponentType<IconProps>;

// A single navigation item
type NavItem = {
	title: string;
	url: string;
	icon?: Icon;
	isEnabled?: (userMembership: TeamMembership) => boolean;
	isAvailable?: boolean;
	items?: NavItem[]; // For grouped items
};

// External link (for help section)
type ExternalLink = {
	name: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	isEnabled?: (userMembership: TeamMembership) => boolean;
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
			url: "/$orgSlug/$projSlug/events",
			icon: Brodcast,
		},
		{
			title: "App Logs",
			url: "/$orgSlug/$projSlug/app-logs",
			icon: LogsIcon,
		},
		{
			title: "Request Logs",
			url: "/$orgSlug/$projSlug/request-logs",
			icon: Global,
		},
		{
			title: "Metrics",
			url: "/$orgSlug/$projSlug/metrics",
			icon: TestTubesIcon,
			isAvailable: false,
		},
		{
			title: "Traces",
			url: "/$orgSlug/$projSlug/traces",
			icon: TracesIcon,
			isAvailable: false,
		},
	],

	settings: [
		{
			title: "Alerts",
			url: "/$orgSlug/$projSlug/alerts",
			icon: Warning2,
			isAvailable: false,
		},
		{
			title: "Organization Settings",
			url: "/$orgSlug/$projSlug/settings/organization",
			icon: BuildingIcon,
			isEnabled: (userMembership) =>
				["admin", "owner"].includes(userMembership.role),
			isAvailable: false,
		},
		{
			title: "Project Settings",
			url: "/$orgSlug/$projSlug/settings/project",
			icon: LibraryBigIcon,
			isEnabled: (userMembership) =>
				["admin", "owner"].includes(userMembership.role),
			isAvailable: false,
		},
		{
			title: "API Keys",
			url: "/$orgSlug/$projSlug/settings/api-keys",
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
function filterMenuForUser(menu: Menu, userMembership: TeamMembership): Menu {
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

	// Remove the first two path segments (orgSlug and projSlug)
	const itemUrlParts = itemUrl.split("/").slice(3).join("/");
	const pathnameParts = pathname.split("/").slice(3).join("/");

	if (!pathnameParts) return itemUrlParts === "";
	if (!itemUrlParts) return false;

	if (pathnameParts === itemUrlParts) return true;

	if (pathnameParts.startsWith(itemUrlParts)) {
		const nextChar = pathnameParts.charAt(itemUrlParts.length);
		return nextChar === "/";
	}

	return false;
}

/**
 * Organization logo and selector component
 */
function SidebarLogo() {
	const { state, isMobile } = useSidebar();
	const { session } = useRouteContext({
		from: "/_authd/$orgSlug/$projSlug/_dashboard",
	});

	const { orgSlug, projSlug } = useParams({
		from: "/_authd/$orgSlug/$projSlug/_dashboard",
	});

	const { data: userOrgs, isLoading } = useQuery(
		listUserOrganizationMembershipsQueryOptions(),
	);

	const activeOrganization = userOrgs?.find(
		(org) => org.organization_id === session.active_organization,
	)?.organization;

	return (
		<>
			{isLoading ? (
				<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[5vh] pt-4">
					<Loader2 className="animate-spin size-4" />
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
											"flex items-center gap-2",
											state === "collapsed" && "justify-center",
										)}
									>
										<div className="flex items-center justify-center transition-all dark:bg-[#EDFFB2] bg-[#E1FF80] rounded-full size-8">
											<Logo
												className="transition-all size-4 shrink-0"
												logoUrl={activeOrganization?.logo || undefined}
												variant="iconOnly"
											/>
										</div>
										<div
											className={cn(
												"flex flex-col items-start whitespace-nowrap",
												state === "collapsed" && "hidden",
											)}
										>
											<p className="text-sm font-medium leading-none">
												{activeOrganization?.name ?? "Select Organization"}
											</p>
										</div>
									</div>
									<ChevronsUpDown
										className={cn("ml-auto", state === "collapsed" && "hidden")}
									/>
								</SidebarMenuButton>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								className="rounded-lg min-w-[12.5rem]"
								align="start"
								side={isMobile ? "bottom" : "right"}
								sideOffset={4}
							>
								<DropdownMenuLabel className="text-xs text-muted-foreground">
									Organizations
								</DropdownMenuLabel>
								{userOrgs?.map(({ organization: org }) => (
									<div className="flex flex-row justify-between" key={org.name}>
										<DropdownMenuSub>
											<DropdownMenuSubTrigger className="w-full items-center gap-2 p-2">
												<Logo
													className="size-4"
													logoUrl={org.logo ?? undefined}
												/>
												<span>{org.name}</span>
											</DropdownMenuSubTrigger>
											<DropdownMenuPortal>
												<DropdownMenuSubContent
													className="min-w-[12.5rem]"
													sideOffset={4}
												>
													<DropdownMenuLabel className="text-xs text-muted-foreground">
														Projects
													</DropdownMenuLabel>
													{org.projects.map((project) => (
														<DropdownMenuItem key={project.id} asChild>
															<Link
																to="/$orgSlug/$projSlug"
																data-active={
																	project.slug === projSlug &&
																	org.slug === orgSlug
																}
																params={{
																	orgSlug: org.slug,
																	projSlug: project.slug,
																}}
															>
																{project.name}
															</Link>
														</DropdownMenuItem>
													))}
													<DropdownMenuSeparator />
													<AddProject />
												</DropdownMenuSubContent>
											</DropdownMenuPortal>
										</DropdownMenuSub>
									</div>
								))}
								<DropdownMenuSeparator />
								<AddOrganization />
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
			)}
		</>
	);
}

/**
 * Renders a navigation item
 */
function NavItemComponent({
	item,
	orgSlug,
	projSlug,
	pathname,
}: {
	item: NavItem;
	orgSlug: string;
	projSlug: string;
	pathname: string;
}) {
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
							to={item.url}
							params={{ orgSlug, projSlug }}
							data-active={isActive}
							className="flex w-full items-center gap-2"
						>
							{item.icon && (
								<item.icon
									className={cn(isActive && "text-primary")}
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
									<ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
								)}
							</SidebarMenuButton>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<SidebarMenuSub>
								{item.items?.map((subItem) => (
									<SidebarMenuSubItem key={subItem.title}>
										<SidebarMenuSubButton asChild>
											<Link
												to={subItem.url}
												params={{ orgSlug, projSlug }}
												data-active={isActiveRoute(subItem.url, pathname)}
												className="flex w-full items-center"
											>
												{subItem.icon && (
													<span className="mr-2">
														<subItem.icon
															className={cn(
																"h-4 w-4 text-muted-foreground",
																isActive && "text-primary",
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

/**
 * Main sidebar component
 */
interface AppSidebarProps {
	children: React.ReactNode;
}

export function AppSidebar({ children }: AppSidebarProps) {
	const { sidebarStates, currentUserOrg } = useRouteContext({
		from: "/_authd/$orgSlug/$projSlug/_dashboard",
	});

	const { orgSlug, projSlug } = useParams({
		from: "/_authd/$orgSlug/$projSlug/_dashboard",
	});

	const router = useRouter();
	const pathname = router.latestLocation.pathname;

	const filteredMenu = filterMenuForUser(MENU, currentUserOrg);

	const { data: invitations, refetch: refetchInvitations } = useQuery(
		listInvitationsQueryOptions(),
	);
	const { refetch } = useQuery(listUserOrganizationMembershipsQueryOptions());

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
					<SidebarLogo />
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
									to="/$orgSlug/$projSlug"
									data-active={isActiveRoute(
										`/${orgSlug}/${projSlug}`,
										pathname,
									)}
									params={{ orgSlug, projSlug }}
									className="flex w-full items-center gap-2"
								>
									<Category2 className="text-primary" color="currentColor" />
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
									orgSlug={orgSlug}
									projSlug={projSlug}
									pathname={pathname}
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
									orgSlug={orgSlug}
									projSlug={projSlug}
									pathname={pathname}
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
						{/* Notifications */}
						<SidebarMenuItem className="group-data-[collapsible=icon]:-translate-x-0.5">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="relative h-8 w-8 p-1.5 mx-auto"
									>
										<Bell className="size-4" />
										{invitations && invitations.length > 0 && (
											<span className="absolute -top-0 -right-0 flex size-4 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
												{invitations.length}
											</span>
										)}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									side="right"
									className="w-80"
								>
									<DropdownMenuLabel>Pending Invitations</DropdownMenuLabel>
									<div className="flex flex-col gap-2">
										{invitations && invitations.length > 0 ? (
											invitations.map((invitation) => (
												<div
													key={invitation.id}
													className="flex flex-col gap-2"
												>
													<DropdownMenuItem
														className="flex flex-col items-start gap-1 p-3"
														onSelect={(e) => e.preventDefault()}
													>
														<div className="font-medium">
															{invitation?.organization?.name}
														</div>
														<div className="text-xs text-muted-foreground">
															Expires:{" "}
															{new Date(invitation.expires_at).toLocaleString()}
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
															const { error } = await acceptInvitation({
																data: { token: invitation.token },
															});

															if (error) {
																toast.error(
																	error.message || "Error accepting invitation",
																);
															} else {
																toast.success(
																	"Invitation accepted successfully",
																);
																await refetchInvitations();
																await refetch();
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
						<SidebarTrigger className="group-data-[collapsible=]:translate-x-0.5" />
						<SidebarMenuItem className="min-h-12 flex items-center">
							<UserNav />
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
