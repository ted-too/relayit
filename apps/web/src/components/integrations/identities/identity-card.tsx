import type { ProviderIdentity } from "@repo/shared/db/types";
import { Badge } from "@repo/ui/components/base/badge";
import { Button } from "@repo/ui/components/base/button";
import { Card } from "@repo/ui/components/base/card";
import { ConfirmAction } from "@repo/ui/components/custom/confirm-action";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSignIcon } from "lucide-react";
import { useTRPC } from "@/integrations/trpc/react";

export function IdentityCard({
  identity,
  providerCredentialId,
}: {
  identity: ProviderIdentity;
  providerCredentialId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { mutateAsync: deleteIdentity, isPending: deleteLoading } = useMutation(
    trpc.identities.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.identities.list.queryOptions({ providerCredentialId })
            .queryKey,
        });
        toast.success("Identity deleted successfully");
      },
      onError: (error) => {
        toast.error("Failed to delete identity", {
          description: error.message,
        });
      },
    })
  );

  return (
    <Card className="ml-6 flex flex-row items-center gap-3 px-3 py-2">
      <AtSignIcon className="size-3 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">
            {identity.channelData?.email?.name ? (
              <>
                "{identity.channelData.email.name}" &lt;{identity.identifier}&gt;
              </>
            ) : (
              identity.identifier
            )}
          </span>
          {identity.isDefault && (
            <Badge variant="secondary" className="text-xs">
              Default
            </Badge>
          )}
          {!identity.isActive && (
            <Badge variant="outline" className="text-xs">
              Inactive
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          <span>Added: {new Date(identity.createdAt).toLocaleDateString()}</span>
          {identity.channelData?.email?.name && (
            <span>Display Name: {identity.channelData.email.name}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ConfirmAction
          execute={async () => {
            await deleteIdentity({ id: identity.id });
          }}
          isLoading={deleteLoading}
          confirm="Delete"
          title="Delete Identity"
          description="Are you sure you want to delete this identity? This action cannot be undone."
          verificationText={identity.identifier}
        >
          <Button size="sm" variant="outline-destructive">
            Delete
          </Button>
        </ConfirmAction>
      </div>
    </Card>
  );
}
