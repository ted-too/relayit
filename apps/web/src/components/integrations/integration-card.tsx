import type { ProviderCredential } from "@repo/shared/db/types";
import { Button } from "@repo/ui/components/base/button";
import { Card } from "@repo/ui/components/base/card";
import { ConfirmAction } from "@repo/ui/components/custom/confirm-action";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/integrations/trpc/react";
import { PROVIDER_ICONS } from "./icons";

export function IntegrationCard({
  integration,
}: {
  integration: ProviderCredential;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { mutateAsync: deleteIntegration, isPending: deleteLoading } =
    useMutation(
      trpc.integrations.delete.mutationOptions({
        onSuccess: async () => {
          await queryClient.invalidateQueries({
            queryKey: trpc.integrations.list.queryOptions().queryKey,
          });
          toast.success("Integration deleted successfully");
        },
        onError: (error) => {
          toast.error("Failed to delete integration", {
            description: error.message,
          });
        },
      })
    );

  const Icon = PROVIDER_ICONS[integration.providerType];

  return (
    <Card className="flex flex-row items-center gap-3 px-4 py-3">
      <Icon className="size-4" />
      <div className="flex flex-col">
        <span className="font-semibold text-sm">{integration.name}</span>
        <span className="text-muted-foreground text-xs">
          Created: {new Date(integration.createdAt).toLocaleDateString()}
        </span>
      </div>
      <ConfirmAction
        execute={async () => {
          await deleteIntegration({ id: integration.id });
        }}
        isLoading={deleteLoading}
        confirm="Delete"
        title="Delete Integration"
        description="Are you sure you want to delete this integration? This action cannot be undone."
        verificationText={`${integration.providerType}-${integration.channelType}`}
      >
        <Button size="sm" variant="outline-destructive" className="ms-auto">
          Delete
        </Button>
      </ConfirmAction>
    </Card>
  );
}
