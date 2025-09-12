import {
  AVAILABLE_PROVIDER_TYPES,
  PROVIDER_CONFIG,
} from "@repo/shared/providers";
import { TooltipProvider } from "@repo/ui/components/animate-ui/base/tooltip";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/base/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CreateIntegrationDialog } from "@/components/integrations/create-form";
import { PROVIDER_ICONS } from "@/components/integrations/icons";
import { IntegrationCard } from "@/components/integrations/integration-card";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute(
  "/_authd/$projectSlug/settings/integrations"
)({
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(
      context.trpc.integrations.list.queryOptions()
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.integrations.list.queryOptions());

  return (
    <TooltipProvider delay={0}>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">Integrations</CardTitle>
          <CardDescription>Integrate with external providers.</CardDescription>
          <CardAction>
            <div className="flex flex-col items-end gap-2">
              <span className="text-muted-foreground text-xs">Available</span>
              <div className="flex flex-wrap gap-4">
                {AVAILABLE_PROVIDER_TYPES.map((type) => {
                  const Icon = PROVIDER_ICONS[type];
                  const config = PROVIDER_CONFIG[type];
                  return (
                    <CreateIntegrationDialog
                      key={type}
                      type={type}
                      Icon={Icon}
                      config={config}
                    />
                  );
                })}
              </div>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          {data.map((key) => (
            <IntegrationCard key={key.id} integration={key} />
          ))}
          {data.length === 0 && (
            <div className="flex flex-col gap-2 py-4">
              <p className="text-muted-foreground text-sm">
                No integrations found, select one to get started.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
