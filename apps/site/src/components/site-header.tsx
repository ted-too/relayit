import {
  RiArrowRightLine,
  RiCloseLine,
  RiGithubFill,
  RiMenuLine,
} from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { cn } from "@repo/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { site } from "@/lib/site";
import type { Viewer } from "@/lib/viewer.functions";

interface SiteHeaderProps {
  readonly appUrl: string;
  readonly viewer: Viewer | null;
}

const navLinkClass =
  "rounded-md px-2.5 py-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:text-foreground";

function ViewerAvatar({ viewer }: { viewer: Viewer }) {
  const initial = (viewer.name ?? viewer.email ?? "").trim().charAt(0);
  if (viewer.image) {
    return (
      <img
        alt=""
        className="size-7 rounded-full border object-cover"
        height={28}
        src={viewer.image}
        width={28}
      />
    );
  }
  if (!initial) {
    return null;
  }
  return (
    <span className="flex size-7 items-center justify-center rounded-full bg-brand-ink font-medium text-brand-mint text-xs uppercase">
      {initial}
    </span>
  );
}

function AccountActions({ appUrl, viewer }: SiteHeaderProps) {
  if (viewer) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="hidden items-center gap-2 sm:flex">
          <ViewerAvatar viewer={viewer} />
          {viewer.name && (
            <span className="max-w-[14ch] truncate text-muted-foreground text-sm">
              {viewer.name}
            </span>
          )}
        </span>
        <Button render={<a href={appUrl} />} size="sm">
          Open dashboard
          <RiArrowRightLine />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button
        className="hidden sm:inline-flex"
        render={<a href={`${appUrl}/auth/sign-in`} />}
        size="sm"
        variant="ghost"
      >
        Sign in
      </Button>
      <Button render={<a href={`${appUrl}/auth/sign-up`} />} size="sm">
        Start sending
      </Button>
    </div>
  );
}

export function SiteHeader({ appUrl, viewer }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onDocs = pathname.startsWith("/docs") || pathname.startsWith("/legal");

  return (
    <header
      className="sticky top-0 z-40 w-full border-transparent border-b bg-background/80 backdrop-blur-lg data-[docs=true]:border-border supports-[backdrop-filter]:bg-background/70"
      data-docs={onDocs}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 md:px-8">
        <Link aria-label={`${site.name} home`} to="/">
          <BrandMark />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <Link className={navLinkClass} params={{ _splat: "" }} to="/docs/$">
            Docs
          </Link>
          <Link
            activeOptions={{ includeHash: true }}
            className={navLinkClass}
            hash="plans"
            to="/"
          >
            Plans
          </Link>
          <Link
            className={navLinkClass}
            params={{ _splat: "self-hosting" }}
            to="/docs/$"
          >
            Self-host
          </Link>
          <a className={navLinkClass} href={site.links.apiReference}>
            API reference
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            aria-label="Relayit on GitHub"
            className="hidden md:inline-flex"
            render={
              <a href={site.links.github} rel="noreferrer" target="_blank" />
            }
            size="icon"
            variant="ghost"
          >
            <RiGithubFill />
          </Button>
          <ThemeToggle />
          <span className="mx-1 hidden h-5 w-px bg-border md:block" />
          <AccountActions appUrl={appUrl} viewer={viewer} />
          <Button
            aria-expanded={open}
            aria-label="Menu"
            className="md:hidden"
            onClick={() => setOpen((value) => !value)}
            size="icon"
            variant="ghost"
          >
            {open ? <RiCloseLine /> : <RiMenuLine />}
          </Button>
        </div>
      </div>
      <nav
        className={cn(
          "grid gap-1 border-b bg-background px-4 pb-4 md:hidden",
          open ? "grid" : "hidden"
        )}
      >
        <Link
          className={navLinkClass}
          onClick={() => setOpen(false)}
          params={{ _splat: "" }}
          to="/docs/$"
        >
          Docs
        </Link>
        <Link
          className={navLinkClass}
          hash="plans"
          onClick={() => setOpen(false)}
          to="/"
        >
          Plans
        </Link>
        <Link
          className={navLinkClass}
          onClick={() => setOpen(false)}
          params={{ _splat: "self-hosting" }}
          to="/docs/$"
        >
          Self-host
        </Link>
        <a className={navLinkClass} href={site.links.apiReference}>
          API reference
        </a>
        <a className={navLinkClass} href={site.links.github}>
          GitHub
        </a>
        {!viewer && (
          <a className={navLinkClass} href={`${appUrl}/auth/sign-in`}>
            Sign in
          </a>
        )}
      </nav>
    </header>
  );
}
