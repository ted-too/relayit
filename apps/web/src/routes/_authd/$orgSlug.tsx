import {
  SidebarInset,
  SidebarProvider,
} from "@repo/ui/components/ui/shad/sidebar";
import { useSuspenseQueries } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import {
  BrushSquare,
  Category2,
  Global,
  Hierarchy,
  Key,
  Personalcard,
  Setting4,
} from "iconsax-reactjs";
import { AppHeader } from "@/components/layout/app-header";
import {
  AppSidebar,
  type NavItemGroup,
  type RequiredPermissions,
} from "@/components/layout/app-sidebar";
import { queries } from "@/integrations/queries";

export const Route = createFileRoute("/_authd/$orgSlug")({
  beforeLoad: async ({ context, params }) => {
    const userOrganizations = await context.queryClient.ensureQueryData(
      queries.organizations.list
    );

    const currentOrganization = userOrganizations.find(
      (organization) => organization.slug === params.orgSlug
    );

    if (!currentOrganization) {
      throw redirect({ to: "/" });
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(queries.session.me);
    void context.queryClient.prefetchQuery(
      queries.organizations.bySlug(params.orgSlug)
    );
  },
  component: RouteComponent,
});

const NAV_ITEMS = [
  {
    items: [
      {
        title: "Overview",
        to: "/$orgSlug",
        icon: Category2,
        requiredPermissions: {
          message: ["read"],
        },
      },
      {
        title: "Contacts",
        to: "/$orgSlug/contacts",
        icon: Personalcard,
        requiredPermissions: {
          contact: ["read"],
        },
      },
    ],
  },
  {
    headerTitle: "Automations",
    items: [
      {
        title: "Templates",
        to: "/$orgSlug/automations/templates",
        icon: BrushSquare,
        requiredPermissions: {
          template: ["read"],
        },
      },
      {
        title: "Workflows",
        to: "/$orgSlug/automations/workflows",
        icon: Hierarchy,
        comingSoon: true,
        requiredPermissions: {
          workflow: ["read"],
        },
      },
    ],
  },
  {
    headerTitle: "Settings",
    items: [
      {
        title: "Project details",
        to: "/$orgSlug/project",
        icon: Setting4,
        requiredPermissions: {
          organization: ["update"],
        },
      },
      {
        title: "API keys",
        to: "/$orgSlug/api-keys",
        icon: Key,
        requiredPermissions: {
          apiKey: ["read"],
        },
      },
      {
        title: "Domains",
        to: "/$orgSlug/domains",
        icon: Global,
        requiredPermissions: {
          integration: ["read"],
        },
      },
    ],
  },
] as const satisfies NavItemGroup[];

function RouteComponent() {
  const { sidebarOpen, isMobile, betterAuth } = Route.useRouteContext();
  const { orgSlug } = Route.useParams();
  const pathname = useLocation({
    select: (location) => {
      const prefix = `/${orgSlug}`;
      return location.pathname.startsWith(prefix)
        ? location.pathname.slice(prefix.length) || "/"
        : location.pathname;
    },
  });
  const [{ data: me }, { data: organization }] = useSuspenseQueries({
    queries: [queries.session.me, queries.organizations.bySlug(orgSlug)],
  });

  const member = organization?.members.find(
    (member) => member.userId === me.user.id
  );

  if (!member) {
    return null;
  }

  const FILTERED_NAV_ITEMS = NAV_ITEMS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!item.requiredPermissions) {
        return true;
      }

      const check = (permissions: RequiredPermissions) =>
        betterAuth.organization.checkRolePermission({
          permissions,
          role: member.role,
        });

      return Array.isArray(item.requiredPermissions)
        ? item.requiredPermissions.some(check)
        : check(item.requiredPermissions);
    }),
  })).filter((group) => group.items.length > 0);
  return (
    <div className="flex size-full">
      <SidebarProvider defaultOpen={sidebarOpen} isMobile={isMobile}>
        <AppSidebar
          items={FILTERED_NAV_ITEMS}
          linkParams={{ orgSlug }}
          pathname={pathname}
        />
        <SidebarInset className="grow bg-[hsl(0,0%,98%)] *:data-[slot=balanced-outlet]:mx-auto *:data-[slot=balanced-outlet]:mt-6 *:data-[slot=balanced-outlet]:w-[calc(1200px+3rem)] *:data-[slot=balanced-outlet]:max-w-full *:data-[slot=balanced-outlet]:px-6 *:data-[slot=full-outlet]:mt-0 *:data-[slot=full-outlet]:flex *:data-[slot=full-outlet]:min-h-0 *:data-[slot=full-outlet]:w-full *:data-[slot=full-outlet]:flex-1 *:data-[slot=full-outlet]:flex-col *:data-[slot=full-outlet]:px-4 *:data-[slot=full-outlet]:pb-4 *:data-[slot=full-outlet]:pt-4">
          <AppHeader
            items={FILTERED_NAV_ITEMS}
            linkParams={{ orgSlug }}
            pathname={pathname}
          />
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
