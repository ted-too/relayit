"use client";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@repo/ui/components/animate-ui/base/tooltip";
import { Bot } from "@repo/ui/components/animate-ui/icons/bot";
import { Brush } from "@repo/ui/components/animate-ui/icons/brush";
import { Gauge } from "@repo/ui/components/animate-ui/icons/gauge";
import type { IconProps } from "@repo/ui/components/animate-ui/icons/icon";
import { Layers } from "@repo/ui/components/animate-ui/icons/layers";
import { UsersRound } from "@repo/ui/components/animate-ui/icons/users-round";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@repo/ui/components/base/collapsible";
import { KbdShortcut } from "@repo/ui/components/base/kbd";
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
} from "@repo/ui/components/base/sidebar";
import { SIDEBAR_KEYBOARD_SHORTCUT } from "@repo/ui/constants";
import { cn } from "@repo/ui/lib/utils";
import { Link, useLocation, useRouteContext } from "@tanstack/react-router";
import { BookIcon, ChevronRightIcon, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { OrganizationLogo, SideBarUserNav } from "@/components/layout/user-nav";

type Icon = LucideIcon | React.ComponentType<IconProps<any>>;

type NavItem = {
	title: string;
	url: string;
	icon?: Icon;
	isEnabled?: (role: string) => boolean;
	isAvailable?: boolean;
	edition?: ("cloud" | "self-hosted")[];
	items?: NavItem[];
};

type ExternalLink = {
	name: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
	isEnabled?: (role: string) => boolean;
	isAvailable?: boolean;
	edition?: ("cloud" | "self-hosted")[];
};

type Menu = {
	app: NavItem[];
	settings: NavItem[];
	help?: ExternalLink[];
};

const isAdmin = (role: string) => ["admin", "owner"].includes(role);

const MENU: Menu = {
	app: [
		{
			title: "Apps",
			url: "/apps",
			icon: Layers,
		},
		{
			title: "Contacts",
			url: "/contacts",
			icon: UsersRound,
			isAvailable: false,
		},
		{
			title: "Studio",
			url: "/studio",
			icon: Brush,
			isAvailable: false,
			edition: ["cloud"],
		},
	],
	settings: [
		{
			title: "Providers",
			url: "/settings/providers",
			icon: Bot,
			isEnabled: isAdmin,
			isAvailable: false,
		},
		{
			title: "Usage & Billing",
			url: "/settings/usage-and-billing",
			icon: Gauge,
			isEnabled: isAdmin,
			isAvailable: false,
			edition: ["cloud"],
		},
	],
	help: [
		{
			name: "Documentation",
			url: import.meta.env.VITE_DOCS_URL,
			icon: BookIcon,
		},
	],
};

/**
 * Filters menu items based on user's role and permissions
 */
function filterMenuForUser(menu: Menu, role: string): Menu {
	const edition = import.meta.env.VITE_EDITION;

	return {
		app: menu.app.filter(
			(item) =>
				(item.isEnabled ? item.isEnabled(role) : true) &&
				(item.edition ? item.edition.includes(edition) : true)
		),
		settings: menu.settings.filter(
			(item) =>
				(item.isEnabled ? item.isEnabled(role) : true) &&
				(item.edition ? item.edition.includes(edition) : true)
		),
		help: menu.help?.filter(
			(item) =>
				(item.isEnabled ? item.isEnabled(role) : true) &&
				(item.edition ? item.edition.includes(edition) : true)
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

	if (itemUrl === "/") {
		return pathname === itemUrl;
	}

	if (pathname.startsWith(itemUrl)) {
		return true;
	}

	return false;
}

/**
 * Renders a navigation item
 */
function NavItemComponent({ item }: { item: NavItem }) {
	const pathname = useLocation({ select: (location) => location.pathname });

	const hasSubitems = item.items && item.items.length > 0;
	const isActive = hasSubitems
		? item.items?.some((subItem) => isActiveRoute(subItem.url, pathname))
		: isActiveRoute(item.url, pathname);

	return (
		<Collapsible
			className="group/collapsible"
			defaultOpen={isActive}
			key={item.title}
			render={
				<SidebarMenuItem>
					{hasSubitems ? (
						<>
							<CollapsibleTrigger
								render={
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
								}
							/>
							<CollapsibleContent>
								<SidebarMenuSub>
									{item.items?.map((subItem) => (
										<SidebarMenuSubItem key={subItem.title}>
											<SidebarMenuSubButton
												render={
													<Link
														className="flex w-full items-center"
														data-active={isActiveRoute(subItem.url, pathname)}
														to={subItem.url}
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
												}
											/>
										</SidebarMenuSubItem>
									))}
								</SidebarMenuSub>
							</CollapsibleContent>
						</>
					) : (
						<SidebarMenuButton
							isAvailable={item.isAvailable}
							tooltip={item.title}
							render={
								<Link
									className="flex w-full items-center gap-2"
									data-active={isActive}
									to={item.url}
								>
									{item.icon && (
										<item.icon
											className={cn(isActive && "text-secondary-foreground")}
											color="currentColor"
										/>
									)}
									<span>{item.title}</span>
								</Link>
							}
						/>
					)}
				</SidebarMenuItem>
			}
		/>
	);
}

function SidebarLogo() {
	const { state } = useSidebar();
	return (
		<SidebarMenu
			className={cn(
				"flex gap-2",
				state === "collapsed"
					? "flex-col"
					: "flex-row items-center justify-between"
			)}
		>
			<SidebarMenuItem className={cn("w-full", state === "expanded" && "p-2")}>
				<OrganizationLogo
					size="sm"
					// variant={state === "collapsed" ? "icon" : "full"}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

/**
 * Main sidebar component
 */
interface AppSidebarProps {
	children: React.ReactNode;
}

export function AppSidebar({ children }: AppSidebarProps) {
	const { sidebarOpen, isMobile } = useRouteContext({
		from: "/_authd",
	});

	const filteredMenu = filterMenuForUser(MENU, "currentUserRole");

	return (
		<TooltipProvider>
			<SidebarProvider
				defaultOpen={sidebarOpen}
				isMobile={isMobile}
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
						<SidebarGroup>
							<SidebarGroupLabel>Dashboard</SidebarGroupLabel>
							<SidebarMenu>
								{filteredMenu.app.map((item) => (
									<NavItemComponent item={item} key={item.title} />
								))}
							</SidebarMenu>
						</SidebarGroup>
						<SidebarGroup>
							<SidebarGroupLabel>Settings</SidebarGroupLabel>
							<SidebarMenu className="gap-1">
								{filteredMenu.settings.map((item) => (
									<NavItemComponent item={item} key={item.title} />
								))}
							</SidebarMenu>
						</SidebarGroup>
					</SidebarContent>

					<SidebarFooter>
						<SidebarMenu className="flex flex-col gap-2">
							<Tooltip>
								<TooltipTrigger
									render={
										<SidebarTrigger className="group-data-[collapsible=]:translate-x-0.5" />
									}
								/>
								<TooltipContent side="right">
									<p>
										Open with{" "}
										<KbdShortcut
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
		</TooltipProvider>
	);
}
