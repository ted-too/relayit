import { Button } from "@repo/ui/components/base/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/base/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { TemplateCard } from "@/components/templates/template-card";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute("/_authd/$projectSlug/templates/")({
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(
      context.trpc.templates.list.queryOptions()
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { projectSlug } = Route.useParams();
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.templates.list.queryOptions());
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">Templates</CardTitle>
          <CardDescription>
            Create and manage message templates for your notification channels.
          </CardDescription>
          <CardAction>
            <Button
              render={
                <Link to="/$projectSlug/templates/new" params={{ projectSlug }}>
                  <PlusIcon />
                  New Template
                </Link>
              }
            />
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          {data.map((key) => (
            <TemplateCard key={key.id} template={key} />
          ))}
          {data.length === 0 && (
            <div className="flex flex-col gap-2 py-4">
              <p className="text-muted-foreground text-sm">
                No templates found, create one to get started.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
