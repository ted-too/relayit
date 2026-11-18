import type { AdminProject } from "@repo/contracts/dashboard";
import { Badge } from "@repo/ui/components/reui/badge";
import { Button } from "@repo/ui/components/ui/coss/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@repo/ui/components/ui/shad/item";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DomainPause } from "@/components/admin/domain-pause";
import { CardList } from "@/components/resources/card-list";
import { VERIFICATION_STATUS } from "@/components/settings/custom-domains/item";
import { PAUSED_REASONS } from "@/components/settings/custom-domains/paused-reasons";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd/admin/projects")({
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(queries.admin.listProjects);
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { data: projects } = useSuspenseQuery(queries.admin.listProjects);

  return (
    <div className="flex flex-col gap-8 pb-10">
      {projects.length === 0 && (
        <p className="p-6 text-center text-lg text-muted-foreground">No Projects yet</p>
      )}
      {projects.map((project) => (
        <section className="flex flex-col gap-3" key={project.id}>
          <div className="flex items-baseline gap-2">
            <h2 className="font-semibold text-lg">{project.name}</h2>
            <span className="text-muted-foreground text-sm">/{project.slug}</span>
          </div>
          <CardList
            createCTAContent="once this Project verifies one it will appear here."
            emptyContent="No Domains"
            items={[...project.domains]}
          >
            {(domain) => <DomainRow domain={domain} key={domain.id} />}
          </CardList>
        </section>
      ))}
    </div>
  );
}

function DomainRow({ domain }: { domain: AdminProject["domains"][number] }) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const verification = VERIFICATION_STATUS[domain.verificationStatus];

  return (
    <Item
      className="rounded-none border-t-0 border-r-0 border-l-0 bg-background px-4 py-3 last:border-b-0"
      variant="outline"
    >
      <ItemContent>
        <ItemTitle className="font-medium text-sm">
          {domain.fqdn}
          {domain.isPaused && (
            <Badge size="sm" variant="destructive-light">
              paused
            </Badge>
          )}
        </ItemTitle>
        {domain.isPaused && (
          <ItemDescription>
            {domain.pausedReason
              ? `${PAUSED_REASONS[domain.pausedReason].label}. `
              : "No reason recorded. "}
            New sends are rejected and queued Deliveries fail.
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="gap-3">
        <Badge size="sm" variant={verification.variant}>
          {verification.label}
        </Badge>
        <Button onClick={() => setPauseOpen(true)} size="sm" variant="outline">
          {domain.isPaused ? "Unpause" : "Pause"}
        </Button>
        <DomainPause domain={domain} open={pauseOpen} setOpen={setPauseOpen} />
      </ItemActions>
    </Item>
  );
}
