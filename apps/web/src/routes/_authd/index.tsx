import { RiAdminLine, RiArrowRightSLine, RiMore2Line } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { useSuspenseQueries } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { OrganizationLogo } from "@/components/layout/nav-projects";
import { NavUser } from "@/components/layout/nav-user";
import { listOrganizations } from "@/lib/auth.functions";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd/")({
  beforeLoad: async ({ context }) => {
    const organizations = await listOrganizations();

    await context.queryClient.setQueryData(
      queries.organizations.list.queryKey,
      organizations
    );

    if (organizations.length === 0) {
      throw redirect({
        to: "/create-project",
      });
    }

    if (organizations.length === 1 && organizations[0]?.slug) {
      throw redirect({
        to: "/$orgSlug",
        params: { orgSlug: organizations[0].slug },
      });
    }
  },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(queries.session.me);
  },
  component: RouteComponent,
});

function RouteComponent() {
  const [{ data: organizations }, { data: me }] = useSuspenseQueries({
    queries: [queries.organizations.list, queries.session.me],
  });

  return (
    <div className="flex h-svh w-full flex-col items-center justify-between px-4">
      <div className="mt-[20svh] flex w-full max-w-sm flex-col">
        <h1 className="mb-1 text-center font-bold text-3xl">
          Select a project
        </h1>
        <p className="mb-6 text-center text-muted-foreground">
          You have access to the following projects:
        </p>
        <div className="flex w-full flex-col gap-4">
          {me.user.role === "admin" && (
            <Link
              className="flex w-full items-center gap-4 rounded-lg bg-background p-3 ring-1 ring-foreground/10 transition-shadow hover:shadow-sm"
              to="/admin"
            >
              <RiAdminLine className="size-4 text-primary" />
              <span className="font-medium text-lg">Admin</span>
              <RiArrowRightSLine className="ml-auto size-4" />
            </Link>
          )}
          {organizations.map((organization) => (
            <Link
              className="flex w-full items-center gap-4 rounded-lg bg-background p-3 ring-1 ring-foreground/10 transition-shadow hover:shadow-sm"
              key={organization.id}
              params={{ orgSlug: organization.slug }}
              to="/$orgSlug"
            >
              <OrganizationLogo
                className="size-6"
                logo={organization.logo}
                name={organization.name}
                size={24}
              />
              <span className="font-medium text-lg">{organization.name}</span>
              <RiArrowRightSLine className="ml-auto size-4" />
            </Link>
          ))}
          <Button render={<Link to="/create-project" />} variant="link">
            Create a new project
            <RiArrowRightSLine />
          </Button>
        </div>
      </div>
      <div className="mb-[10svh] flex w-full max-w-xs flex-col items-center gap-2">
        <NavUser
          hideDetails
          render={
            <Button
              className="h-13 w-full gap-2 p-2! text-sm! sm:h-13"
              size="xl"
              variant="outline"
            />
          }
          side="top"
          triggerIcon={<RiMore2Line className="ml-auto size-4" />}
        />
      </div>
    </div>
  );
}
