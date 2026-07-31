import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WorkspaceIde } from "@/components/templates/workspace/ide";
import { queries } from "@/integrations/queries";

const workspaceSearchSchema = z.object({
  templateId: z.string().optional(),
  entryId: z.string().optional(),
  intent: z.enum(["create-new", "manage"]).optional(),
});

export const Route = createFileRoute(
  "/_authd/$orgSlug/automations/templates/workspace"
)({
  validateSearch: (search) => workspaceSearchSchema.parse(search),
  loader: ({ context, params }) => {
    void context.queryClient.ensureQueryData(
      queries.organizations.bySlug(params.orgSlug).workspace("reactEmail")
    );
    void context.queryClient.ensureQueryData(
      queries.organizations.bySlug(params.orgSlug).workspace("reactEmail").files
    );
    void context.queryClient.ensureQueryData(
      queries.organizations.bySlug(params.orgSlug).workspace("reactEmail")
        .entries
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  return (
    <div data-slot="full-outlet">
      <WorkspaceIde search={search} />
    </div>
  );
}
