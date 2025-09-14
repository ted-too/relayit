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
import { CreateApiKeyDialog } from "@/components/api-keys/create-form";
import { ApiKeyCard } from "@/components/api-keys/key-card";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute("/_authd/$projectSlug/settings/api-keys")({
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(
      context.trpc.auth.listApiKeys.queryOptions()
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.auth.listApiKeys.queryOptions());
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-2xl">API keys</CardTitle>
        <CardDescription>Manage your API keys.</CardDescription>
        <CardAction>
          <CreateApiKeyDialog />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {data.map((key) => (
          <ApiKeyCard key={key.id} apiKey={key} />
        ))}
        {data.length === 0 && (
          <div className="flex flex-col gap-2 py-4">
            <p className="text-muted-foreground text-sm">
              No API keys found, create one to get started.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
