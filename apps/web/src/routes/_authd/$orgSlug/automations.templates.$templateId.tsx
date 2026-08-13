import { Badge } from "@repo/ui/components/reui/badge";
import { Button } from "@repo/ui/components/ui/coss/button";
import { formatDateTime } from "@repo/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { TemplateEditSlug } from "@/components/templates/edit-slug";
import { TemplateEmailChannel } from "@/components/templates/email-channel";
import { queries } from "@/lib/queries";

export const Route = createFileRoute(
  "/_authd/$orgSlug/automations/templates/$templateId"
)({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        queries.organizations.bySlug(params.orgSlug).template(params.templateId)
      ),
      context.queryClient.ensureQueryData(
        queries.organizations.bySlug(params.orgSlug).workspace("reactEmail")
          .entries
      ),
    ]);
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { orgSlug, templateId } = Route.useParams();
  const { data: template } = useSuspenseQuery(
    queries.organizations.bySlug(orgSlug).template(templateId)
  );

  if (!template) {
    throw notFound();
  }

  return (
    <div className="flex flex-col gap-6" data-slot="balanced-outlet">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-medium text-3xl">{template.name}</h1>
            <Badge variant="secondary">{template.slug}</Badge>
            {template.archivedAt ? (
              <Badge variant="destructive">Archived</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm">
            Created {formatDateTime(new Date(template.createdAt))} · send with
            slug or id
          </p>
        </div>
        <Button
          render={
            <Link params={{ orgSlug }} to="/$orgSlug/automations/templates" />
          }
          variant="outline"
        >
          Back to Templates
        </Button>
      </div>

      <TemplateEditSlug template={template} />
      <TemplateEmailChannel template={template} />
    </div>
  );
}
