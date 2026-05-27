import { createFileRoute } from "@tanstack/react-router";
import { ProjectDangerZone } from "@/components/settings/project/danger-zone";
import { ProjectEditName } from "@/components/settings/project/edit-name";
import { ProjectEditSlug } from "@/components/settings/project/edit-slug";

export const Route = createFileRoute("/_authd/$orgSlug/settings/project")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex flex-col gap-8">
      <ProjectEditName />
      <ProjectEditSlug />
      <ProjectDangerZone />
    </div>
  );
}
