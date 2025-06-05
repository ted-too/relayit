import Link from "next/link";
import { siteConfig } from "@/lib/config";
import { source } from "@/lib/source";
// import { CommandMenu } from "@/components/command-menu";
import { GitHubLink } from "@/components/github-link";
import { Icons } from "@/components/icons";
import { MainNav } from "@/components/main-nav";
import { MobileNav } from "@/components/mobile-nav";
import { ModeSwitcher } from "@repo/ui/components/mode-switcher";
import { Button } from "@repo/ui/components/shadcn/button";
import { Separator } from "@repo/ui/components/shadcn/separator";

export function SiteHeader() {
	const pageTree = source.pageTree;

	return (
		<header className="bg-background/15 backdrop-blur-lg sticky top-0 z-50 w-full">
			<div className="container-wrapper 3xl:px-0 px-6">
				<div className="3xl:container max-w-[1440px] mx-auto justify-between flex h-(--header-height) items-center gap-2 **:data-[slot=separator]:!h-4">
					<MobileNav
						tree={pageTree}
						items={siteConfig.navItems}
						className="flex lg:hidden"
					/>
					<Button
						asChild
						variant="link"
						size="icon"
						className="hidden h-8 min-w-28 justify-start lg:flex"
					>
						<Link href="/">
							<Icons.logo className="size-6" />
							<span className="sr-only">{siteConfig.name}</span>
						</Link>
					</Button>
					<MainNav items={siteConfig.navItems} className="hidden lg:flex" />
					<div className="flex items-center gap-2 justify-end min-w-28">
						{/* <div className="hidden w-full flex-1 md:flex md:w-auto md:flex-none">
              TODO: Add docs search
							<CommandMenu tree={pageTree} colors={colors} />
						</div> */}
						<Separator
							orientation="vertical"
							className="ml-2 hidden lg:block"
						/>
						<GitHubLink />
						<Separator orientation="vertical" />
						<ModeSwitcher />
					</div>
				</div>
			</div>
		</header>
	);
}
