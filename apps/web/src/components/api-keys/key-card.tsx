import type { ClientParsedApiKey } from "@repo/shared/db/types";
import { Button } from "@repo/ui/components/base/button";
import { Card } from "@repo/ui/components/base/card";
import { ConfirmAction } from "@repo/ui/components/custom/confirm-action";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyIcon } from "lucide-react";
import { useTRPC } from "@/integrations/trpc/react";

export function ApiKeyCard({ apiKey }: { apiKey: ClientParsedApiKey }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { mutateAsync: revokeKey, isPending: revokeLoading } = useMutation(
    trpc.auth.revokeApiKey.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.auth.listApiKeys.queryOptions().queryKey,
        });
        toast.success("API key revoked successfully");
      },
      onError: (error) => {
        toast.error("Failed to revoke API key", {
          description: error.message,
        });
      },
    })
  );

  return (
    <Card
      className="flex flex-row items-center gap-3 px-4 py-3"
    >
      <KeyIcon className="size-4" />
      <div className="flex flex-col">
        <span className="font-semibold text-sm">{apiKey.name}</span>
        <span className="text-muted-foreground text-xs">
          Created: {new Date(apiKey.createdAt).toLocaleDateString()}
        </span>
      </div>
      <ConfirmAction
        execute={async () => {
          await revokeKey({ id: apiKey.id });
        }}
        isLoading={revokeLoading}
        confirm="Revoke"
        title="Revoke API Key"
        description="Are you sure you want to revoke this API key? This action cannot be undone."
        verificationText={apiKey.name ?? undefined}
      >
        <Button size="sm" variant="outline-destructive" className="ms-auto">
          Revoke
        </Button>
      </ConfirmAction>
    </Card>
  );
}
