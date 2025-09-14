import { ModeSwitcher } from "@repo/old-ui/components/mode-switcher";
import { Button } from "@repo/old-ui/components/shadcn/button";
import { Separator } from "@repo/old-ui/components/shadcn/separator";
import Link from "next/link";
// import { CommandMenu } from "@/components/command-menu";
import { GitHubLink } from "@/components/github-link";
import { Icons } from "@/components/icons";
import { MainNav } from "@/components/main-nav";
import { MobileNav } from "@/components/mobile-nav";
import { siteConfig } from "@/lib/config";
import { source } from "@/lib/source";

export function SiteHeader() {
  const pageTree = source.pageTree;

  return (
    <header className="sticky top-0 z-50 w-full bg-background/15 backdrop-blur-lg">
      <div className="container-wrapper 3xl:px-0 px-6">
        <div className="**:data-[slot=separator]:!h-4 3xl:container mx-auto flex h-(--header-height) max-w-[1440px] items-center justify-between gap-2">
          <MobileNav
            className="flex lg:hidden"
            items={siteConfig.navItems}
            tree={pageTree}
          />
          <Button
            asChild
            className="hidden h-8 min-w-28 justify-start lg:flex"
            size="icon"
            variant="link"
          >
            <Link href="/">
              <Icons.logo className="size-6" />
              <span className="sr-only">{siteConfig.name}</span>
            </Link>
          </Button>
          <MainNav className="hidden lg:flex" items={siteConfig.navItems} />
          <div className="flex min-w-28 items-center justify-end gap-2">
            {/* <div className="hidden w-full flex-1 md:flex md:w-auto md:flex-none">
              TODO: Add docs search
							<CommandMenu tree={pageTree} colors={colors} />
						</div> */}
            <Separator
              className="ml-2 hidden lg:block"
              orientation="vertical"
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
