import { RiArrowRightUpLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import type { DocsNavGroup } from "@/lib/docs-nav";

const itemClass =
  "-ml-px flex items-center gap-1 border-transparent border-l py-1 pl-3 text-muted-foreground text-sm transition-colors hover:border-foreground/30 hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground dark:data-[status=active]:border-brand-mint";

interface DocsShellProps {
  readonly children: React.ReactNode;
  readonly groups: readonly DocsNavGroup[];
  readonly to: "/docs/$" | "/legal/$";
}

export function DocsShell({ children, groups, to }: DocsShellProps) {
  return (
    <div className="mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 gap-10 px-4 py-10 md:grid-cols-[13rem_minmax(0,1fr)] md:px-8 md:py-14 xl:grid-cols-[13rem_minmax(0,1fr)_12rem]">
      <aside className="min-w-0 md:sticky md:top-24 md:max-h-[calc(100dvh-7rem)] md:self-start md:overflow-y-auto">
        <nav className="flex gap-6 overflow-x-auto pb-2 md:flex-col md:gap-7 md:overflow-visible md:pb-0">
          {groups.map((group) => (
            <div className="flex shrink-0 flex-col gap-1.5" key={group.title}>
              <p className="font-medium text-sm">{group.title}</p>
              <div className="flex flex-col border-l">
                {group.items.map((item) =>
                  item.kind === "page" ? (
                    <Link
                      activeOptions={{ exact: true }}
                      className={itemClass}
                      key={item.slug}
                      params={{ _splat: item.slug }}
                      to={to}
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <a className={itemClass} href={item.href} key={item.href}>
                      {item.title}
                      <RiArrowRightUpLine className="size-3.5" />
                    </a>
                  )
                )}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      {children}
    </div>
  );
}
