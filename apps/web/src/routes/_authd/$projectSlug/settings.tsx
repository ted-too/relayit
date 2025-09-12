import {
  Highlight,
  HighlightItem,
} from "@repo/ui/components/animate-ui/primitives/effects/highlight";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useParams,
} from "@tanstack/react-router";

export const Route = createFileRoute("/_authd/$projectSlug/settings")({
  component: RouteComponent,
});

const TABS = [
  {
    label: "Project Settings",
    value: "default",
  },
  {
    label: "API Keys",
    value: "api-keys",
  },
  {
    label: "Integrations",
    value: "integrations",
  },
  // {
  //   label: "Team",
  //   value: "team",
  // },
  // {
  //   label: "Usage & Billing",
  //   value: "billing",
  // },
] as const;

function RouteComponent() {
  const { projectSlug } = useParams({
    from: "/_authd/$projectSlug/settings",
  });
  const pathname = useLocation({
    select: (location) => location.pathname.split("/").slice(3).join("/"),
  });
  const currentValue = pathname.length > 0 ? pathname : "default";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center gap-4 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)]">
        <Highlight
          defaultValue={currentValue}
          className="inset-0 border-foreground border-b-2"
          controlledItems
        >
          {TABS.map((tab) => (
            <HighlightItem key={tab.value} value={tab.value}>
              <Link
                to={
                  (tab.value === "default"
                    ? `/${projectSlug}/settings`
                    : `/${projectSlug}/settings/${tab.value}`) as any
                }
                className="flex h-12 cursor-pointer items-center justify-center rounded-full px-4 text-muted-foreground text-sm transition-all duration-300 data-[active=true]:font-medium data-[active=true]:text-current"
              >
                {tab.label}
              </Link>
            </HighlightItem>
          ))}
        </Highlight>
      </div>
      <Outlet />
    </div>
  );
}
