import type { SanitizedProviderCredential } from "@repo/shared/db/types";
import { Badge } from "@repo/ui/components/base/badge";
import { Button } from "@repo/ui/components/base/button";
import { Card } from "@repo/ui/components/base/card";
import { ConfirmAction } from "@repo/ui/components/custom/confirm-action";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/integrations/trpc/react";
import { PROVIDER_ICONS } from "./icons";
import { CreateIdentityDialog } from "./identities/create-form";
import { IdentityCard } from "./identities/identity-card";

export function IntegrationCard({
  integration,
}: {
  integration: SanitizedProviderCredential;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data } = useQuery(
    trpc.identities.list.queryOptions({ providerCredentialId: integration.id })
  );

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
    <div className="flex flex-col gap-2">
      <Card className="flex flex-row items-center gap-3 px-4 py-3">
        <Icon className="size-9.5" />
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{integration.name}</span>
            {integration.isDefault && (
              <Badge variant="secondary" className="text-xs">
                Default
              </Badge>
            )}
            {!integration.isActive && (
              <Badge variant="outline" className="text-xs">
                Inactive
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span>
              Created: {new Date(integration.createdAt).toLocaleDateString()}
            </span>
            <span>Channel: {integration.channelType}</span>
            <span>Priority: {integration.priority}</span>
            {data && <span>Identities: {data.length}</span>}
          </div>
        </div>
        <div className="ms-auto flex items-center gap-4">
          <CreateIdentityDialog providerCredential={integration} />
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
            <Button size="sm" variant="outline-destructive">
              Delete
            </Button>
          </ConfirmAction>
        </div>
      </Card>
      {data?.map((identity) => (
        <IdentityCard
          key={identity.id}
          identity={identity}
          providerCredentialId={integration.id}
        />
      ))}
    </div>
  );
}
