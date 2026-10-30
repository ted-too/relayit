import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand";
import { legalNav } from "@/lib/docs-nav";
import { site } from "@/lib/site";

const linkClass =
  "text-muted-foreground text-sm transition-colors hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-8">
        <div className="flex flex-col items-start gap-4">
          <BrandMark />
          <p className="max-w-[34ch] text-muted-foreground text-sm leading-relaxed">
            Email infrastructure for products. Run it on Relayit Cloud or on
            your own servers.
          </p>
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="font-medium text-sm">Product</p>
          <Link className={linkClass} params={{ _splat: "" }} to="/docs/$">
            Documentation
          </Link>
          <a className={linkClass} href={site.links.apiReference}>
            API reference
          </a>
          <Link className={linkClass} hash="plans" to="/">
            Plans
          </Link>
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="font-medium text-sm">Source</p>
          <a className={linkClass} href={site.links.github}>
            GitHub
          </a>
          <Link
            className={linkClass}
            params={{ _splat: "self-hosting" }}
            to="/docs/$"
          >
            Self-hosting
          </Link>
          <a className={linkClass} href={site.links.openapi}>
            OpenAPI spec
          </a>
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="font-medium text-sm">Legal</p>
          {legalNav.slice(1).map((item) =>
            item.kind === "page" ? (
              <Link
                className={linkClass}
                key={item.slug}
                params={{ _splat: item.slug }}
                to="/legal/$"
              >
                {item.title}
              </Link>
            ) : null
          )}
        </div>
      </div>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-2 border-t px-4 py-6 text-muted-foreground text-xs sm:flex-row sm:justify-between md:px-8">
        <span>© {new Date().getFullYear()} Ted Too. All rights reserved.</span>
        <span>
          A product of{" "}
          <a className="underline underline-offset-2" href={site.links.studio}>
            2labs
          </a>
        </span>
      </div>
    </footer>
  );
}
